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

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await runAssessment(input, (name, data) => {
          controller.enqueue(event(name, data));
        });
        controller.enqueue(event("assessment_complete", result));
      } catch (error) {
        controller.enqueue(event("assessment_error", {
          message: error instanceof Error ? error.message : "The live assessment failed.",
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
