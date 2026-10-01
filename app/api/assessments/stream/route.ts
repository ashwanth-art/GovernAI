import {
  runAssessment,
  STAGE_UNIT_EVENTS,
  validateAssessmentInput,
  type RunStage,
  type RunStageId,
} from "@/lib/assessment";
import { redactLogText, writeExecutionLog } from "@/lib/execution-log";
import { resolveServerCredentials } from "@/lib/server-credentials";
import type { AssessmentInput } from "@/lib/types";

export const runtime = "edge";

const encoder = new TextEncoder();
const event = (name: string, data: unknown) =>
  encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Tracks how far through a run we are, weighted by stage.
 *
 * The previous version counted events: every emitted event that looked terminal
 * advanced the bar by one step. That made the bar a measure of the engine's
 * chattiness rather than of its progress — five network requests worth several
 * seconds each moved it 3%, and a few hundred rows of local arithmetic moved it
 * 94%. Here each stage declares its own share of the bar and its own denominator,
 * so the bar tracks time and the counter inside a stage tracks work.
 */
class StageProgress {
  private stages: RunStage[] = [];
  private units = new Map<RunStageId, number>();
  private active: RunStageId | null = null;

  declare(stages: RunStage[]) {
    this.stages = stages;
    if (!this.active && stages.length) this.active = stages[0].id;
  }

  enter(stageId: RunStageId) {
    this.active = stageId;
  }

  /** Attributes a completing event to the stage that owns that event name. */
  record(name: string): void {
    const owner = this.stages.find((stage) => STAGE_UNIT_EVENTS[stage.id]?.includes(name));
    if (!owner) return;
    this.units.set(owner.id, (this.units.get(owner.id) ?? 0) + 1);
  }

  private stageFraction(stage: RunStage): number {
    const done = this.units.get(stage.id) ?? 0;
    return Math.min(1, done / Math.max(1, stage.unitTotal));
  }

  snapshot() {
    const totalWeight = this.stages.reduce((sum, stage) => sum + stage.weight, 0) || 1;
    const earned = this.stages.reduce(
      (sum, stage) => sum + stage.weight * this.stageFraction(stage),
      0,
    );
    const totalUnits = this.stages.reduce((sum, stage) => sum + stage.unitTotal, 0) || 1;
    const doneUnits = this.stages.reduce(
      (sum, stage) => sum + Math.min(stage.unitTotal, this.units.get(stage.id) ?? 0),
      0,
    );
    const activeStage = this.stages.find((stage) => stage.id === this.active);
    return {
      totalSteps: totalUnits,
      completedSteps: doneUnits,
      pendingSteps: Math.max(0, totalUnits - doneUnits),
      percentage: Math.max(0, Math.min(100, Math.round((earned / totalWeight) * 100))),
      stageId: this.active,
      stageLabel: activeStage?.label ?? "",
      stageCompleted: activeStage ? Math.min(activeStage.unitTotal, this.units.get(activeStage.id) ?? 0) : 0,
      stageTotal: activeStage?.unitTotal ?? 0,
      stages: this.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        weight: stage.weight,
        unitTotal: stage.unitTotal,
        unitsDone: Math.min(stage.unitTotal, this.units.get(stage.id) ?? 0),
      })),
    };
  }

  complete() {
    for (const stage of this.stages) this.units.set(stage.id, stage.unitTotal);
    this.active = this.stages.at(-1)?.id ?? null;
  }
}

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
  input = resolveServerCredentials(input);
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
      const streamStarted = Date.now();
      const progress = new StageProgress();
      try {
        const result = await runAssessment(input, (name, data) => {
          if (name === "assessment_start" && Array.isArray(data.stages)) {
            progress.declare(data.stages as RunStage[]);
          }
          if (name === "stage_start" && data.stageId) {
            progress.enter(data.stageId as RunStageId);
          }
          progress.record(name);
          sequence += 1;
          controller.enqueue(event(name, {
            ...data,
            sequence,
            occurredAt: new Date().toISOString(),
            elapsedMs: Date.now() - streamStarted,
            progress: progress.snapshot(),
          }));
        }, { eventDelayMs: 90 });
        sequence += 1;
        progress.complete();
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
          elapsedMs: Date.now() - streamStarted,
          progress: progress.snapshot(),
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
          elapsedMs: Date.now() - streamStarted,
          progress: progress.snapshot(),
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
