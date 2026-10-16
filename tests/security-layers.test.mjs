import assert from "node:assert/strict";
import test from "node:test";
import { securityRules, securityPillars, evaluateLayerExport, summarizeSecurityPillars, layerExportTemplate } from "../server/review/security-layers.mjs";
import { collectAuthorizationMatrix, collectEntra } from "../server/review/collectors-identity.mjs";
import { collectExport } from "../server/review/collectors.mjs";
import { credentialObservations, parseCredentialReport } from "../server/review/aws-identity.mjs";
import { technicalManifest, exportedManifest } from "../server/review/evaluate.mjs";
import { validateProfile } from "../server/review/broker.mjs";
import { createReviewService } from "../server/review/service.mjs";

const target = "https://app.example", now = new Date().toISOString();
const fieldsFor = rule => Object.fromEntries(Object.entries(rule.fields).map(([field, condition]) => [field, condition === "true" ? true : condition === "false" ? false : condition === "zero" ? 0 : 10]));
const measurement = rule => ({ ruleId: rule.id, assetId: "application-scope", sourceRef: "https://security.example/records/123", collectedAt: now, fields: fieldsFor(rule) });
const fixture = (selected = securityRules) => ({ schemaVersion: "2.0", targetOrigin: target, generatedAt: now, scope: { id: "bank-app-1", complete: true, assetIds: ["application-scope"] }, measurements: selected.map(measurement) });
const evidence = result => ({ ...result, id: "record", hash: "abc", layer: "security_export", source: "https://security.example/export", collectedAt: now });

test("all seven pillars have reachable typed rules; fresh complete fixtures pass without claimed verdicts", () => {
  assert.equal(securityPillars.length, 7);
  for (const pillar of securityPillars) assert.ok(securityRules.some(rule => rule.layer === pillar.id), pillar.id);
  const result = evaluateLayerExport(fixture(), target);
  assert.equal(result.observations.length, 30);
  assert.ok(result.observations.every(item => item.status === "pass"));
  const summaries = summarizeSecurityPillars([evidence(result)]);
  assert.ok(summaries.every(pillar => pillar.passed > 0 && pillar.failed === 0 && pillar.missingRuleIds.length === 0));
  assert.equal(Object.keys(technicalManifest([evidence(result)])).length, 30);
  assert.equal(result.bankingProcedures["artifact-bank-privileged-access"].status, "pass");
});

test("every rule detects real typed violations; claimed passes, strings, missing values and negative counts cannot manufacture a pass", () => {
  for (const rule of securityRules) {
    const bad = fixture([rule]); const [field, condition] = Object.entries(rule.fields)[0];
    bad.measurements[0].status = "pass";
    bad.measurements[0].fields[field] = condition === "true" ? false : condition === "false" ? true : condition === "zero" ? 1 : 0;
    assert.equal(evaluateLayerExport(bad, target).observations[0].status, condition === "positive" ? "not_assessed" : "fail", rule.id);
    const zeroField = Object.entries(rule.fields).find(([, required]) => required === "zero");
    bad.measurements[0].fields = fieldsFor(rule);
    bad.measurements[0].fields[zeroField[0]] = 1;
    assert.equal(evaluateLayerExport(bad, target).observations[0].status, "fail", rule.id);
    bad.measurements[0].fields = fieldsFor(rule);
    bad.measurements[0].fields[field] = "0";
    assert.equal(evaluateLayerExport(bad, target).observations[0].status, "not_assessed", rule.id);
    delete bad.measurements[0].fields[field];
    assert.equal(evaluateLayerExport(bad, target).observations[0].status, "not_assessed", rule.id);
  }
});

test("stale, cross-target, unsafe, sampled and incomplete exports cannot pass", () => {
  assert.throws(() => evaluateLayerExport({ ...fixture(), targetOrigin: "https://other.example" }, target));
  assert.throws(() => evaluateLayerExport({ ...fixture(), generatedAt: "2000-01-01" }, target));
  const sampled = fixture([securityRules[0]]); sampled.scope.complete = false;
  assert.equal(evaluateLayerExport(sampled, target).observations[0].status, "not_assessed");
  sampled.measurements[0].fields.terminatedUsersWithAccess = 1;
  assert.equal(evaluateLayerExport(sampled, target).observations[0].status, "fail");
  assert.deepEqual(evaluateLayerExport(sampled, target).bankingProcedures, {});
  for (const change of [{ collectedAt: "2000-01-01" }, { sourceRef: "https://security.example/a?token=secret" }, { sourceRef: "https://user:secret@security.example/a" }, { assetId: "unrelated-asset" }]) {
    const item = fixture([securityRules[0]]); Object.assign(item.measurements[0], change);
    assert.equal(evaluateLayerExport(item, target).observations[0].status, "not_assessed");
  }
  const missingAsset = fixture([securityRules[0]]); missingAsset.scope.assetIds.push("unmeasured-asset");
  const readings = technicalManifest([evidence(evaluateLayerExport(missingAsset, target))]);
  assert.equal(readings["artifact-review-security-iam-lifecycle"].status, "not_assessed");
  assert.throws(() => evaluateLayerExport({ ...fixture(), measurements: [{ ruleId: "artifact-review-tls-valid" }] }, target));
});

test("contradictory duplicate evidence preserves failures and partial bank measurements cannot produce broad passes", () => {
  const input = fixture(); const bad = structuredClone(input.measurements.find(item => item.ruleId === "iam-mfa"));
  bad.fields.privilegedMfaEnforced = false; input.measurements.push(bad);
  const result = evaluateLayerExport(input, target);
  assert.equal(technicalManifest([evidence(result)])["artifact-review-security-iam-mfa"].status, "fail");
  assert.equal(result.bankingProcedures["artifact-bank-privileged-access"].status, "fail");
  const partial = evaluateLayerExport(fixture(securityRules.filter(rule => rule.id === "iam-mfa")), target);
  assert.equal(partial.bankingProcedures["artifact-bank-privileged-access"].status, "not_assessed");
});

test("nested role-conflict analysis handles cycles, ownership and terminated identities without claiming effective permissions", () => {
  const input = fixture([]);
  input.identityGraph = { sourceRef: "https://iam.example/snapshot", collectedAt: now, inventoryComplete: true,
    principals: [{ id: "employee", kind: "user", enabled: true, terminated: true, ownerAssigned: false }, { id: "group-a", kind: "group" }, { id: "group-b", kind: "group" }, { id: "maker", kind: "role" }, { id: "checker", kind: "role" }],
    assignments: [{ principalId: "employee", targetId: "group-a", relation: "member_of" }, { principalId: "group-a", targetId: "group-b", relation: "member_of" }, { principalId: "group-b", targetId: "group-a", relation: "member_of" }, { principalId: "group-b", targetId: "maker", relation: "assigned_role" }, { principalId: "employee", targetId: "checker", relation: "assigned_role" }],
    conflictPolicy: { approved: true, sourceRef: "https://grc.example/approved-sod", collectedAt: now, rolePairs: [["maker", "checker"]] },
  };
  const result = evaluateLayerExport(input, target);
  assert.equal(result.observations.find(item => item.id === "identity-graph-lifecycle").status, "fail");
  const conflict = result.observations.find(item => item.id === "identity-graph-role-conflicts");
  assert.equal(conflict.status, "fail"); assert.equal(conflict.conflicts.length, 1);
  assert.deepEqual(conflict.conflicts[0].paths[0], ["employee", "group-a", "group-b", "maker"]);
  input.identityGraph.collectedAt = "2000-01-01";
  assert.ok(evaluateLayerExport(input, target).observations.every(item => item.status === "not_assessed"));
});

test("missing pillars remain explicit gaps, not zero-failure all-clears", () => {
  const summaries = summarizeSecurityPillars([]);
  assert.equal(summaries.length, 7);
  assert.ok(summaries.every(item => item.passed === 0 && item.failed === 0 && item.missingRuleIds.length > 0));
  const template = layerExportTemplate(target);
  assert.equal(template.measurements.length, 0); assert.equal(template.scope.complete, false);
});

test("authorization matrix requires a working identity before accepting denial and never retains tokens or bodies", async () => {
  const records = [], calls = [];
  const profile = { config: { identities: [{ id: "alice", token: "sensitive-test-token" }], tests: [{ identityId: "alice", url: `${target}/forbidden`, expect: "deny" }, { identityId: "alice", url: `${target}/mine`, expect: "allow" }] } };
  let allowWorks = false;
  const context = { target: new URL(target), save: async item => records.push(item), broker: { fetch: async (url, options) => { calls.push(url); const status = !options?.headers?.Authorization ? 401 : url.endsWith("mine") ? allowWorks ? 200 : 401 : 403; return { ok: status === 200, status, text: "secret body" }; } } };
  await collectAuthorizationMatrix(context, profile);
  assert.ok(records[0].observations.every(item => item.status === "not_assessed"));
  allowWorks = true; await collectAuthorizationMatrix(context, profile);
  assert.ok(records[1].observations.every(item => item.status === "pass"));
  assert.ok(calls[0].endsWith("mine")); assert.ok(!JSON.stringify(records).includes("sensitive-test-token")); assert.ok(!JSON.stringify(records).includes("secret body"));
  context.broker.fetch = async (_url, options) => options?.headers?.Authorization ? { ok: true, status: 200 } : { ok: false, status: 401 };
  await collectAuthorizationMatrix(context, profile);
  assert.equal(records[2].observations[1].status, "fail");
});

test("identity profiles reject unbounded scopes, unsafe URLs, missing baselines and cross-account analyzers", () => {
  const profile = { kind: "auth", name: "matrix", targetOrigin: target, config: { url: `${target}/private`, identities: [{ id: "a", token: "x" }], tests: [{ identityId: "a", url: `${target}/private`, expect: "deny" }] } };
  assert.throws(() => validateProfile(profile), /baseline/);
  profile.config.tests[0].expect = "allow"; assert.equal(validateProfile(profile).kind, "auth");
  profile.config.tests[0].url = "https://other.example/a"; assert.throws(() => validateProfile(profile));
  assert.throws(() => validateProfile({ kind: "entra", name: "bad", targetOrigin: target, config: { tenantId: "a".repeat(36), principalIds: [] } }));
  assert.throws(() => validateProfile({ kind: "aws", name: "bad", targetOrigin: target, config: { accountId: "123456789012", regions: ["ap-south-1"], accessAnalyzerArn: "arn:aws:access-analyzer:ap-south-1:000000000000:analyzer/other" } }));
});

test("AWS credential audit is scoped, fresh and conservative about missing key-activity timestamps", () => {
  const headers = "user,password_enabled,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_2_active";
  const old = new Date(Date.now() - 100 * 86400000).toISOString();
  const report = { GeneratedTime: new Date(), Content: Buffer.from(`${headers}\nselected,true,false,true,${old},N/A,false\nunrelated,true,false,false,N/A,N/A,false\n`) };
  const obs = credentialObservations(report, { accountId: "123456789012", iamUserNames: ["selected"], maximumCredentialAgeDays: 90, maximumCredentialIdleDays: 90 });
  assert.deepEqual(obs.map(item => item.status), ["fail", "fail", "not_assessed"]);
  assert.ok(!JSON.stringify(obs).includes("unrelated"));
  assert.equal(credentialObservations({ ...report, GeneratedTime: "2000-01-01" }, {}).length, 1);
  assert.equal(parseCredentialReport('user,mfa_active\n"a,b",true\n')[0].user, "a,b");
});

test("Entra uses Graph audience and approved read paths; registration is never labeled enforcement", async () => {
  const id = "11111111-1111-4111-8111-111111111111", records = [], urls = [];
  const context = { save: async item => records.push(item), broker: { azureToken: async (_profile, scope) => { assert.equal(scope, "https://graph.microsoft.com/.default"); return "secret"; }, fetch: async (url, options) => {
    urls.push(url); assert.equal(options.method ?? "GET", "GET");
    if (url.includes("/users/")) return { ok: true, json: { id, accountEnabled: true, userPrincipalName: "test@example.com" } };
    if (url.includes("userRegistrationDetails")) return { ok: true, json: { value: [{ id, isMfaRegistered: false }] } };
    return { ok: true, json: { value: [] } };
  } } };
  await collectEntra(context, { config: { tenantId: id, principalIds: [id] } });
  const reading = records.flatMap(item => item.observations).find(item => item.id === "entra-mfa-registration");
  assert.equal(reading.status, "fail"); assert.match(reading.summary, /does not establish MFA enforcement/);
  assert.ok(urls.every(url => url.startsWith("https://graph.microsoft.com/v1.0/"))); assert.ok(!JSON.stringify(records).includes("test@example.com"));
});

test("connected layer export emits trusted deployment evidence and exact bank measurements, never arbitrary procedures", async () => {
  const records = [], input = fixture(); input.procedures = { "artifact-review-tls-valid": { status: "pass" } };
  await collectExport({ target: new URL(target), broker: { fetch: async () => ({ ok: true, source: "https://security.example/export", json: input }) }, save: async item => records.push(item) }, { kind: "security_export", config: { url: "https://security.example/export" } });
  const saved = { ...records[0], id: "record", hash: "abc" };
  assert.equal(technicalManifest([saved])["artifact-review-tls-valid"], undefined);
  assert.equal(exportedManifest([saved])["artifact-bank-privileged-access"].status, "pass");
});

test("Entra explicit policy and time-bound role rules reject report-only policies and permanent active assignments", async () => {
  const id = "11111111-1111-4111-8111-111111111111", roleId = "22222222-2222-4222-8222-222222222222", records = [];
  const context = { save: async item => records.push(item), broker: { azureToken: async () => "test", fetch: async url => {
    if (url.includes("conditionalAccess/policies")) return { ok: true, json: { state: "enabledForReportingButNotEnforced" } };
    if (url.includes("/users/")) return { ok: true, json: { id, accountEnabled: false } };
    if (url.includes("roleAssignmentScheduleInstances")) return { ok: true, json: { value: [{ principalId: id, roleDefinitionId: roleId, assignmentType: "Assigned", startDateTime: new Date(Date.now() - 86400000).toISOString(), endDateTime: null }] } };
    return { ok: false, status: 403 };
  } } };
  await collectEntra(context, { config: { tenantId: id, principalIds: [id], requiredConditionalAccessPolicyIds: [roleId], requireTimeBoundRoles: true, privilegedRoleDefinitionIds: [roleId] } });
  const observations = records.flatMap(item => item.observations);
  assert.equal(observations.find(item => item.id === "entra-required-policy-state").status, "fail");
  assert.equal(observations.find(item => item.id === "entra-timebound-roles").status, "fail");
  assert.equal(observations.find(item => item.id === "entra-mfa-registration").status, "not_assessed");
});

test("security export template is available through the existing authenticated review API", async () => {
  const store = { init: async () => {}, enqueueDue: async () => {}, claim: async () => null };
  const service = createReviewService({ store, enabled: true, sessionKey: "test-session-key", engineFetch: async () => Response.json({}) });
  try {
    await service.init;
    const response = await service.route(new Request(`https://governance.example/api/reviews/security-template?target=${encodeURIComponent(target)}`));
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.targetOrigin, target); assert.equal(body.contract.length, 30); assert.equal(body.measurements.length, 0);
  } finally { await service.close(); }
});
