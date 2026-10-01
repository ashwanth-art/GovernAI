import { standardById } from "@/lib/catalog";
import { buildCheckPlan, type AccessSignals } from "@/lib/plan";
import { writeExecutionLog } from "@/lib/execution-log";
import type { AccessTier } from "@/lib/types";

export const runtime = "edge";

interface PlanRequest {
  standardIds?: string[];
  tier?: AccessTier;
  access?: AccessSignals;
}

/**
 * Pre-flight. Returns the rules that will run, the rules that will not, and the
 * coverage each tier can reach — before a single request is sent to the target.
 *
 * Takes no credentials. Access is described by presence flags only, so planning
 * a run never puts a token on the wire.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let body: PlanRequest;
  try {
    body = (await request.json()) as PlanRequest;
  } catch {
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const standardIds = (body.standardIds ?? []).filter((id) => standardById.has(id));
  const tier = ([1, 2, 3] as AccessTier[]).includes(body.tier as AccessTier)
    ? (body.tier as AccessTier)
    : 1;
  if (!standardIds.length) {
    return Response.json({ errors: ["Select at least one framework before planning a run."] }, { status: 422 });
  }

  const plan = buildCheckPlan({
    standardIds,
    tier,
    access: body.access,
  });

  writeExecutionLog({
    module: "app/api/plan/route",
    functionName: "POST",
    executionStage: "check_plan",
    inputSummary: `tier=${tier}; standards=${standardIds.length}`,
    outputSummary: `${plan.runnableChecks}/${plan.totalChecks} rules runnable; ${plan.boundedRequests} bounded requests`,
    durationMs: Date.now() - started,
    status: "success",
  });

  return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
}
