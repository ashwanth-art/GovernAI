import { runAssessment, validateAssessmentInput } from "@/lib/assessment";
import { redactLogText, writeExecutionLog } from "@/lib/execution-log";
import type { AssessmentInput } from "@/lib/types";

export const runtime = "edge";

const encoder = new TextEncoder();
const event = (name: string, data: unknown) =>
  encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

export async function POST(request: Request) {
  let input: AssessmentInput;
  try {
    input = (await request.json()) as AssessmentInput;
  } catch {
    writeExecutionLog({
      module: "app/api/assessments/stream/route",
      functionName: "POST",
      executionStage: "request_parsing",
      inputSummary: "Unreadable JSON request body",
      outputSummary: "HTTP 400",
      durationMs: 0,
      status: "failure",
      errorDetails: "Request body must be valid JSON.",
    });
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }
  const errors = validateAssessmentInput(input);
  if (errors.length) {
    writeExecutionLog({
      module: "app/api/assessments/stream/route",
      functionName: "POST",
      executionStage: "input_validation",
      inputSummary: `tier=${input.tier}; standards=${input.standardIds?.length ?? 0}`,
      outputSummary: `HTTP 422; ${errors.length} validation error(s)`,
      durationMs: 0,
      status: "failure",
      errorDetails: errors.join("; "),
    });
    return Response.json({ errors }, { status: 422 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let sequence = 0;
      let totalSteps = 1;
      let completedSteps = 0;
      const streamStarted = Date.now();
      const completedEventNames = new Set([
        "probe_complete",
        "control_result",
        "standard_complete",
        "owasp_complete",
      ]);
      try {
        const result = await runAssessment(input, (name, data) => {
          if (name === "assessment_start") totalSteps = Number(data.totalSteps) || 1;
          if (completedEventNames.has(name)) completedSteps += 1;
          sequence += 1;
          controller.enqueue(event(name, {
            ...data,
            sequence,
            occurredAt: new Date().toISOString(),
            progress: {
              totalSteps,
              completedSteps: Math.min(completedSteps, totalSteps),
              pendingSteps: Math.max(0, totalSteps - completedSteps),
              percentage: Math.min(100, Math.round((completedSteps / totalSteps) * 100)),
            },
          }));
        }, { eventDelayMs: 90 });
        sequence += 1;
        controller.enqueue(event("execution_summary", {
          standard: "Assessment",
          control: "Final execution summary",
          status: result.liveEvidence.execution.summary.failedSteps > 0 ? "partial" : "pass",
          message: `${result.liveEvidence.execution.summary.completedSteps} steps completed in ${result.liveEvidence.execution.summary.durationMs} ms with ${result.liveEvidence.execution.summary.warningSteps} warnings and ${result.liveEvidence.execution.summary.failedSteps} failures.`,
          module: "app/api/assessments/stream/route",
          functionName: "POST",
          executionStage: "assessment_complete",
          inputSummary: `tier=${input.tier}; standards=${input.standardIds.length}`,
          outputSummary: `${result.reports.length} reports generated`,
          durationMs: result.liveEvidence.execution.summary.durationMs,
          sequence,
          occurredAt: new Date().toISOString(),
          progress: {
            totalSteps,
            completedSteps: totalSteps,
            pendingSteps: 0,
            percentage: 100,
          },
        }));
        controller.enqueue(event("assessment_complete", result));
      } catch (error) {
        sequence += 1;
        const message = redactLogText(
          error instanceof Error ? error.message : "The live assessment failed.",
        );
        controller.enqueue(event("assessment_error", {
          standard: "Assessment",
          control: "Execution failed",
          status: "fail",
          message,
          errorCode: "ASSESSMENT_EXECUTION_FAILED",
          details: message,
          retryable: true,
          module: "app/api/assessments/stream/route",
          functionName: "POST",
          executionStage: "assessment_failed",
          inputSummary: `tier=${input.tier}; standards=${input.standardIds.length}`,
          outputSummary: "No final assessment result was generated.",
          durationMs: Date.now() - streamStarted,
          sequence,
          occurredAt: new Date().toISOString(),
          progress: {
            totalSteps,
            completedSteps,
            pendingSteps: Math.max(0, totalSteps - completedSteps),
            percentage: Math.min(100, Math.round((completedSteps / totalSteps) * 100)),
          },
        }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
