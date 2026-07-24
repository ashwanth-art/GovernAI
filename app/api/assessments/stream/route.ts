import { runAssessment, validateAssessmentInput } from "@/lib/assessment";
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
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }
  const errors = validateAssessmentInput(input);
  if (errors.length) return Response.json({ errors }, { status: 422 });

  const result = runAssessment(input);
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(event("assessment_start", {
        assessmentId: result.assessmentId,
        standards: result.scope.selectedStandards,
      }));
      for (const report of result.reports) {
        controller.enqueue(event("standard_start", {
          standardId: report.standardId,
          standard: report.shortName,
          total: report.totalControls,
        }));
        for (const control of report.controls) {
          controller.enqueue(event("control_result", {
            standardId: report.standardId,
            standard: report.shortName,
            controlId: control.id,
            control: control.name,
            status: control.status,
            score: control.score,
            pillars: control.pillars,
          }));
        }
        controller.enqueue(event("standard_complete", {
          standardId: report.standardId,
          standard: report.shortName,
          score: report.score,
        }));
      }
      controller.enqueue(event("owasp_complete", {
        total: result.owasp.length,
        findings: result.owasp.filter((control) => control.status !== "pass").length,
      }));
      controller.enqueue(event("assessment_complete", result));
      controller.close();
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

