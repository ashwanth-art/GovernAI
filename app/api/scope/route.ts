import { standardById } from "@/lib/catalog";
import { scopeSummary } from "@/lib/plan";
import { writeExecutionLog } from "@/lib/execution-log";
import type { AccessTier } from "@/lib/types";

export const runtime = "edge";

interface ScopeRequest {
  standardIds?: string[];
  tier?: AccessTier;
}

/**
 * What applies, and why.
 *
 * Returns the applicable / excluded / unresolved split per framework with the
 * engine's own reason for every exclusion. No pack asks scope questions, so
 * every control of a selected framework applies.
 */
export async function POST(request: Request) {
  const started = Date.now();
  let body: ScopeRequest;
  try {
    body = (await request.json()) as ScopeRequest;
  } catch {
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const standardIds = (body.standardIds ?? []).filter((id) => standardById.has(id));
  const tier = ([1, 2, 3] as AccessTier[]).includes(body.tier as AccessTier)
    ? (body.tier as AccessTier)
    : 1;
  if (!standardIds.length) {
    return Response.json(
      { errors: ["Select at least one framework before resolving what applies."] },
      { status: 422 },
    );
  }

  const summary = scopeSummary({ standardIds, tier });

  writeExecutionLog({
    module: "app/api/scope/route",
    functionName: "POST",
    executionStage: "applicability_scoping",
    inputSummary: `tier=${tier}; standards=${standardIds.length}`,
    outputSummary: `${summary.applicable} applicable; ${summary.notApplicable} excluded; ${summary.unknown} unresolved`,
    durationMs: Date.now() - started,
    status: summary.unknown > 0 ? "warning" : "success",
  });

  return Response.json(
    summary,
    { headers: { "Cache-Control": "no-store" } },
  );
}
