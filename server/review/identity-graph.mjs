/** Rules over source-supplied identity facts and an explicit approved role-
 * conflict policy. Assignment paths are NOT an AWS/Azure effective-permission
 * solver: restricting policies and runtime conditions still require evidence.
 */
export function analyzeIdentityGraph(graph, { complete, fresh }) {
  const observations = [];
  const identities = graph.principals.filter(item => ["user", "workload"].includes(item.kind));
  const known = identities.filter(item => [item.enabled, item.terminated, item.ownerAssigned].every(value => typeof value === "boolean"));
  const violations = known.filter(item => item.enabled && (item.terminated || !item.ownerAssigned));
  observations.push({ id: "identity-graph-lifecycle", securityPillar: "identity", provenance: "connected_tool_export",
    status: !fresh ? "not_assessed" : violations.length ? "fail" : !complete || !identities.length || known.length !== identities.length ? "not_assessed" : "pass",
    summary: `${violations.length} source-reported active identities are terminated or have no accountable owner. ${known.length}/${identities.length} identity records have typed lifecycle facts. Scope completeness and HR/directory reconciliation are source-declared.`,
    affectedIdentityIds: fresh ? violations.map(item => item.id) : [],
  });
  const policy = graph.conflictPolicy;
  if (!policy) return observations;
  const principalById = new Map(graph.principals.map(item => [item.id, item]));
  if (!Array.isArray(policy.rolePairs) || policy.rolePairs.length > 100 || !policy.rolePairs.every(pair => Array.isArray(pair) && pair.length === 2 && pair[0] !== pair[1] && pair.every(id => principalById.get(id)?.kind === "role"))) throw new Error("Conflict policy needs at most 100 pairs of declared role IDs.");
  const adjacency = new Map();
  for (const edge of graph.assignments.filter(item => ["member_of", "assigned_role"].includes(item.relation))) adjacency.set(edge.principalId, [...(adjacency.get(edge.principalId) ?? []), edge.targetId]);
  const conflicts = [];
  for (const identity of identities) {
    if (identity.enabled === false) continue;
    const seen = new Set([identity.id]), queue = [identity.id], paths = new Map([[identity.id, [identity.id]]]);
    while (queue.length) {
      const from = queue.shift();
      for (const to of adjacency.get(from) ?? []) if (principalById.has(to) && !seen.has(to)) { seen.add(to); queue.push(to); paths.set(to, [...paths.get(from), to]); }
    }
    for (const pair of policy.rolePairs) if (pair.every(role => seen.has(role))) conflicts.push({ identityId: identity.id, rolePair: pair, paths: pair.map(role => paths.get(role)) });
  }
  const approved = policy.approved === true && typeof policy.sourceRef === "string" && /^https:\/\//.test(policy.sourceRef);
  observations.push({ id: "identity-graph-role-conflicts", securityPillar: "identity", provenance: "connected_tool_export",
    status: !fresh || !approved ? "not_assessed" : conflicts.some(conflict => principalById.get(conflict.identityId).enabled === true) ? "fail" : !complete || !identities.length || !policy.rolePairs.length || identities.some(item => typeof item.enabled !== "boolean") ? "not_assessed" : "pass",
    summary: `${conflicts.length} assigned-role conflict(s) found through direct or nested group paths against the source-supplied role-conflict policy. This evaluates incompatible assignments, not whether a payment can actually be executed.`,
    conflicts: fresh && approved ? conflicts : [],
  });
  return observations;
}
