import rules from "../../lib/security-layer-rules.json" with { type: "json" };
import { analyzeIdentityGraph } from "./identity-graph.mjs";

export const securityRules = rules;
export const securityPillars = [
  { id: "identity", name: "Users and identities" }, { id: "device", name: "Devices" },
  { id: "application", name: "Applications and workloads" }, { id: "data", name: "Data" },
  { id: "network", name: "Networks and environment" }, { id: "automation", name: "Automation and orchestration" },
  { id: "visibility", name: "Visibility and analytics" },
];
const ruleById = new Map(rules.map(rule => [rule.id, rule]));
const fresh = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 300000 && now - Date.parse(value) <= 30 * 86400000;
const identifier = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\r\n]/.test(value);
const sourceReference = value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
};

/** Only explicitly connected tool exports enter here, never target discovery or
 * model output. Publisher verdicts are ignored. Completeness is scoped and
 * declared by the source, not independently established by this reviewer.
 */
export function evaluateLayerExport(value, targetOrigin, now = Date.now()) {
  if (value?.schemaVersion !== "2.0" || value.targetOrigin !== targetOrigin || !fresh(value.generatedAt, now) || !identifier(value.scope?.id) || typeof value.scope.complete !== "boolean" || !Array.isArray(value.scope.assetIds) || !value.scope.assetIds.length || value.scope.assetIds.length > 500 || !value.scope.assetIds.every(identifier) || !Array.isArray(value.measurements) || value.measurements.length > 500) {
    throw new Error("Security export needs schemaVersion 2.0, matching targetOrigin, a fresh generatedAt, explicit scope assetIds/completeness and at most 500 measurements.");
  }
  const assets = new Set(value.scope.assetIds), observations = [], identities = [], edges = [];
  if (assets.size !== value.scope.assetIds.length) throw new Error("Declared scope asset IDs must be unique.");
  const ruleAssets = value.scope.ruleAssets ?? {};
  if (!ruleAssets || typeof ruleAssets !== "object" || Array.isArray(ruleAssets) || Object.entries(ruleAssets).some(([id, ids]) => !ruleById.has(id) || !Array.isArray(ids) || !ids.length || !ids.every(id => assets.has(id)))) throw new Error("Per-rule asset scope must name known rules and assets in the source inventory.");
  for (const entry of value.measurements) {
    const rule = ruleById.get(entry?.ruleId);
    if (!rule) throw new Error("Unknown security rule in export; arbitrary procedure IDs are not accepted.");
    const expectedAssets = ruleAssets[rule.id] ?? value.scope.assetIds;
    const valid = expectedAssets.includes(entry.assetId) && sourceReference(entry.sourceRef) && fresh(entry.collectedAt, now) && entry.fields && typeof entry.fields === "object" && !Array.isArray(entry.fields);
    const missing = [], failures = [], measured = {};
    for (const [field, condition] of Object.entries(rule.fields)) {
      const actual = valid ? entry.fields[field] : undefined;
      const typed = condition === "true" || condition === "false" ? typeof actual === "boolean" : Number.isSafeInteger(actual) && actual >= 0;
      if (!typed) { missing.push(field); continue; }
      measured[field] = actual;
      if (condition === "positive" && actual === 0) { missing.push(`${field} (no assessed population)`); continue; }
      if (condition === "true" ? actual !== true : condition === "false" ? actual !== false : condition === "zero" ? actual !== 0 : actual <= 0) failures.push(`${field}=${actual}`);
    }
    // A sampled/incomplete export may prove a violation, never an all-clear.
    const status = !valid ? "not_assessed" : failures.length ? "fail" : missing.length || !value.scope.complete ? "not_assessed" : "pass";
    observations.push({ id: `security-${rule.id}`, status, securityPillar: rule.layer,
      summary: `${rule.name}: ${failures.length ? `violations: ${failures.join(", ")}` : status === "pass" ? "required measurements satisfied within the source-declared scope" : "insufficient fresh, complete measurements"}.${missing.length ? ` Missing/invalid: ${missing.join(", ")}.` : ""} Asset ${assets.has(entry.assetId) ? entry.assetId : "outside scope"}; measured ${valid ? entry.collectedAt : "unknown"}. Tool-export evidence; not an independent inventory-completeness attestation.`,
      assetId: assets.has(entry.assetId) ? entry.assetId : undefined, measured, sourceRef: valid ? entry.sourceRef : undefined,
      measuredAt: valid ? entry.collectedAt : undefined, scopeId: value.scope.id, sourceDeclaredComplete: value.scope.complete,
      provenance: "connected_tool_export",
    });
  }
  for (const ruleId of new Set(value.measurements.map(entry => entry.ruleId))) {
    const expected = ruleAssets[ruleId] ?? value.scope.assetIds;
    if (expected.some(asset => !value.measurements.some(entry => entry.ruleId === ruleId && entry.assetId === asset))) observations.push({ id: `security-${ruleId}`, securityPillar: ruleById.get(ruleId).layer, status: "not_assessed", summary: "One or more assets in this rule's declared scope have no measurement. A healthy sample cannot establish a scope-wide pass.", scopeId: value.scope.id, provenance: "connected_tool_export" });
  }
  // Optional inventory graph: relationships are facts supplied by the source,
  // not proof that a grant is effective after every deny/restricting policy.
  const graph = value.identityGraph;
  if (graph !== undefined) {
    if (!Array.isArray(graph.principals) || graph.principals.length > 500 || !Array.isArray(graph.assignments) || graph.assignments.length > 1000) throw new Error("Identity graph exceeds its bounded inventory schema.");
    const principalIds = new Set();
    for (const principal of graph.principals) {
      if (!identifier(principal.id) || !["user", "group", "role", "workload"].includes(principal.kind) || principalIds.has(principal.id)) throw new Error("Identity graph principal IDs must be unique and typed.");
      principalIds.add(principal.id);
      identities.push({ id: `${value.scope.id}:${principal.id}`, kind: `identity:${principal.kind}`, name: principal.id });
    }
    for (const assignment of graph.assignments) {
      if (!principalIds.has(assignment.principalId) || !identifier(assignment.targetId) || !["member_of", "assigned_role", "granted_on", "can_assume"].includes(assignment.relation)) throw new Error("Identity graph assignment is malformed.");
      const to = principalIds.has(assignment.targetId) ? `${value.scope.id}:${assignment.targetId}` : assets.has(assignment.targetId) ? assignment.targetId : null;
      if (!to) throw new Error("Identity graph assignment target is outside the declared inventory.");
      const targetKind = graph.principals.find(principal => principal.id === assignment.targetId)?.kind;
      if (assignment.relation === "member_of" && targetKind !== "group" || ["assigned_role", "can_assume"].includes(assignment.relation) && targetKind !== "role" || assignment.relation === "granted_on" && !assets.has(assignment.targetId)) throw new Error("Identity relationship does not match its declared target kind.");
      edges.push({ from: `${value.scope.id}:${assignment.principalId}`, to, relation: assignment.relation });
    }
    if (graph.conflictPolicy && !sourceReference(graph.conflictPolicy.sourceRef)) throw new Error("Role-conflict policy needs a safe HTTPS source reference.");
    const graphFresh = sourceReference(graph.sourceRef) && fresh(graph.collectedAt, now) && (!graph.conflictPolicy || fresh(graph.conflictPolicy.collectedAt, now));
    observations.push(...analyzeIdentityGraph(graph, { complete: value.scope.complete && graph.inventoryComplete === true, fresh: graphFresh }).map(item => ({ ...item, scopeId: value.scope.id, sourceRef: graphFresh ? graph.sourceRef : undefined, measuredAt: graphFresh ? graph.collectedAt : undefined, policySourceRef: graph.conflictPolicy?.sourceRef })));
  }
  const bankingProcedures = {};
  // Exact field mapping only. A console-MFA registration observation cannot
  // establish privileged enforcement, SoD or access-review completion.
  const required = { privilegedMfaEnforced: "iam-mfa", overdueAccessReviews: "iam-reviews", segregationConflicts: "iam-sod", orphanedPrivilegedAccounts: "iam-pam" };
  if (value.scope.complete) {
    const measurements = {};
    for (const [field, ruleId] of Object.entries(required)) {
      const all = observations.filter(item => item.id === `security-${ruleId}`);
      const items = all.filter(item => item.measured && Object.hasOwn(item.measured, field));
      // Do not join incomparable asset scopes or let missing readings disappear.
      const expected = ruleAssets[ruleId] ?? value.scope.assetIds;
      if (!all.length || all.some(item => item.status === "not_assessed") || items.length !== all.length || new Set(expected).size !== assets.size || expected.some(id => !assets.has(id))) continue;
      measurements[field] = field === "privilegedMfaEnforced" ? items.every(item => item.measured[field] === true) : Math.max(...items.map(item => item.measured[field]));
    }
    if (Object.keys(measurements).length) bankingProcedures["artifact-bank-privileged-access"] = { status: Object.entries(measurements).some(([field, measured]) => field === "privilegedMfaEnforced" ? measured === false : measured > 0) ? "fail" : Object.keys(measurements).length === 4 ? "pass" : "not_assessed", summary: `Exact privileged-access measurements from a scoped connected tool export (${value.scope.id}); no inference from MFA registration or endpoint status.`, measurements, collectedAt: value.generatedAt };
  }
  return { observations, bankingProcedures, assets: [...assets].map(id => ({ id, kind: "scoped_asset" })).concat(identities), edges, scope: { id: value.scope.id, sourceDeclaredComplete: value.scope.complete, provenance: "connected_tool_export" } };
}

const directLayers = {
  dns: "network", tls: "network", frontend: "application", browser: "application", authentication: "identity",
  monitoring: "visibility", audit: "visibility", source: "application", identity: "identity", data: "data",
};
const layerForObservation = id => /^aws-admin-|^dns-|^tls-/.test(id) ? "network" : /^azure-storage-|^azure-vault-|^aws-storage-/.test(id) ? "data" : /^aws-root-|^aws-iam-|^entra-|^auth-/.test(id) ? "identity" : /^azure-diagnostics|^aws-trail-|^aws-alarm-|^aws-log-/.test(id) ? "visibility" : /^azure-runtime-/.test(id) ? "application" : null;
export function summarizeSecurityPillars(evidence) {
  return securityPillars.map(pillar => {
    const expected = rules.filter(rule => rule.layer === pillar.id).map(rule => `security-${rule.id}`);
    const readings = evidence.flatMap(record => (record.observations ?? []).filter(observation => (observation.securityPillar ?? layerForObservation(observation.id) ?? directLayers[record.layer]) === pillar.id).map(observation => ({ ...observation, evidenceId: record.id })));
    const grouped = new Map();
    for (const reading of readings) grouped.set(reading.id, [...(grouped.get(reading.id) ?? []), reading]);
    const outcomes = [...grouped].map(([id, items]) => ({ id, status: items.some(item => item.status === "fail") ? "fail" : items.some(item => item.status === "partial") ? "partial" : items.some(item => item.status !== "pass") ? "not_assessed" : "pass", evidenceIds: [...new Set(items.map(item => item.evidenceId))] }));
    return { ...pillar, passed: outcomes.filter(item => item.status === "pass").length, failed: outcomes.filter(item => item.status === "fail").length, unresolved: outcomes.filter(item => !["pass", "fail"].includes(item.status)).length,
      missingRuleIds: expected.filter(id => !grouped.has(id)), outcomes, scope: "Observed assets only; not an attestation of whole-bank coverage." };
  });
}

export function layerExportTemplate(targetOrigin) {
  return { schemaVersion: "2.0", targetOrigin, generatedAt: new Date().toISOString(), scope: { id: "REPLACE-with-source-scope", complete: false, assetIds: ["REPLACE-with-asset-id"] }, measurements: [],
    contract: rules.map(rule => ({ ruleId: rule.id, pillar: rule.layer, requiredFields: rule.fields, remediation: rule.fix })),
    instructions: "Populate measurements with ruleId, assetId, collectedAt, sourceRef (HTTPS without query/credentials) and typed fields from actual source records. Do not submit invented healthy defaults. Missing fields or incomplete scope cannot pass. Optional identityGraph contains principals and assignments; it does not establish effective permissions." };
}
