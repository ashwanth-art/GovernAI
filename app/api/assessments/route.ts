import { runAssessment, validateAssessmentInput } from "@/lib/assessment";
import type { AssessmentInput } from "@/lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  let input: AssessmentInput;
  try {
    input = (await request.json()) as AssessmentInput;
  } catch {
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }
  const errors = validateAssessmentInput(input);
  if (errors.length) return Response.json({ errors }, { status: 422 });
  try {
    return Response.json(await runAssessment(input), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { errors: [error instanceof Error ? error.message : "The live assessment failed."] },
      { status: 502 },
    );
  }
}
