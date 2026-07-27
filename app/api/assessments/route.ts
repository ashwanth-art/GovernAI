import { runAssessment, validateAssessmentInput } from "@/lib/assessment";
import { writeExecutionLog } from "@/lib/execution-log";
import type { AssessmentInput } from "@/lib/types";

export const runtime = "edge";

export async function POST(request: Request) {
  let input: AssessmentInput;
  try {
    input = (await request.json()) as AssessmentInput;
  } catch {
    writeExecutionLog({
      module: "app/api/assessments/route",
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
      module: "app/api/assessments/route",
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
