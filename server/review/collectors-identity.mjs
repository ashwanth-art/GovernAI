/** Fixed, read-only identity calls. No arbitrary Graph paths, policy writes,
 * role activation, password reads or account creation are exposed to profiles.
 */
export async function collectEntra(context, profile) {
  const token = await context.broker.azureToken(profile, "https://graph.microsoft.com/.default");
  const get = path => context.broker.fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` }, allowedOrigins: ["https://graph.microsoft.com"], limit: 500000 });
  const save = async (source, observations, detail = {}) => context.save({ layer: "identity", source, collectedAt: new Date().toISOString(), observations, ...detail });
  for (const id of profile.config.requiredConditionalAccessPolicyIds ?? []) {
    const policy = await get(`/identity/conditionalAccess/policies/${id}`);
    const state = policy.json?.state;
    await save(`entra-policy://${profile.config.tenantId}/${id}`, [{ id: "entra-required-policy-state", status: !policy.ok || !["enabled", "disabled", "enabledForReportingButNotEnforced"].includes(state) ? "not_assessed" : state === "enabled" ? "pass" : "fail", securityPillar: "identity", summary: "Explicitly required Conditional Access policy state. Enabled is not proof of MFA coverage: exclusions, grant logic, client/device conditions and actual sign-ins need separate applicability evidence." }]);
  }
  for (const id of profile.config.principalIds) {
    const source = `entra://${profile.config.tenantId}/${id}`;
    const user = await get(`/users/${id}?$select=id,accountEnabled,userType,userPrincipalName`);
    if (user.ok) {
      const upn = user.json?.userPrincipalName;
      const registration = typeof upn === "string" ? await get(`/reports/authenticationMethods/userRegistrationDetails?$filter=${encodeURIComponent(`userPrincipalName eq '${upn.replaceAll("'", "''")}'`)}`) : { ok: false };
      const registrations = registration.json?.value;
      const value = Array.isArray(registrations) && registrations.length === 1 && registrations[0].id === id ? registrations[0].isMfaRegistered : undefined;
      await save(source, [{ id: "entra-mfa-registration", status: user.json?.accountEnabled === true && registration.ok && typeof value === "boolean" ? value ? "pass" : "fail" : "not_assessed", summary: "Scoped user MFA registration only. Registration does not establish MFA enforcement or Conditional Access applicability.", assetId: source, securityPillar: "identity" }], { assets: [{ id: source, kind: "identity:user", name: id }] });
    } else if (user.status === 404) {
      const service = await get(`/servicePrincipals/${id}?$select=id,accountEnabled,keyCredentials,passwordCredentials`);
      const keys = service.json?.keyCredentials, passwords = service.json?.passwordCredentials;
      const dates = service.ok && Array.isArray(keys) && Array.isArray(passwords) ? [...keys, ...passwords].map(key => Date.parse(key.endDateTime)) : [];
      await save(source, [{ id: "entra-credential-expiry", status: service.json?.accountEnabled !== true || !dates.length || dates.some(date => !Number.isFinite(date)) ? "not_assessed" : dates.some(date => date <= Date.now()) ? "fail" : "pass", summary: "Scoped service-principal credential metadata expiry. No secret values retained; federation and actual credential use are not inferred.", assetId: source, securityPillar: "identity" }], { assets: service.ok ? [{ id: source, kind: "identity:workload", name: id }] : [] });
    } else {
      await save(source, [{ id: "entra-mfa-registration", status: "not_assessed", summary: `Scoped directory read unavailable (HTTP ${user.status}); Azure resource Reader does not confer directory access.` }]);
    }
    const assignments = await get(`/roleManagement/directory/roleAssignments?$filter=${encodeURIComponent(`principalId eq '${id}'`)}`);
    if (assignments.ok && Array.isArray(assignments.json?.value)) await save(source, [], {
      edges: assignments.json.value.filter(item => item.principalId === id).map(item => ({ from: source, to: `entra-role:${profile.config.tenantId}/${item.roleDefinitionId}`, relation: "assigned_role" })),
      assets: assignments.json.value.filter(item => item.principalId === id).map(item => ({ id: `entra-role:${profile.config.tenantId}/${item.roleDefinitionId}`, kind: "identity:role" })),
      directAssignmentsOnly: true, truncated: Boolean(assignments.json["@odata.nextLink"]),
      limitation: "Direct Entra role assignments only. Group inheritance, PIM eligibility, Azure RBAC and effective permissions require additional evidence.",
    });
    else await save(source, [{ id: "entra-role-inventory", status: "not_assessed", summary: `Directory role assignments unavailable (HTTP ${assignments.status}).`, securityPillar: "identity" }]);
    if (profile.config.requireTimeBoundRoles === true) {
      const schedule = await get(`/roleManagement/directory/roleAssignmentScheduleInstances?$filter=${encodeURIComponent(`principalId eq '${id}'`)}`);
      const entries = Array.isArray(schedule.json?.value) ? schedule.json.value.filter(item => item.principalId === id && profile.config.privilegedRoleDefinitionIds.includes(item.roleDefinitionId)) : [];
      const active = entries.filter(item => !item.startDateTime || Date.parse(item.startDateTime) <= Date.now()).filter(item => !item.endDateTime || Date.parse(item.endDateTime) > Date.now());
      const permanent = active.some(item => (item.startDateTime === null || Number.isFinite(Date.parse(item.startDateTime))) && item.assignmentType === "Assigned" && item.endDateTime === null);
      const unknown = !schedule.ok || Boolean(schedule.json?.["@odata.nextLink"]) || !active.length || active.some(item => item.startDateTime !== null && !Number.isFinite(Date.parse(item.startDateTime)) || !["Assigned", "Activated"].includes(item.assignmentType) || item.endDateTime !== null && !Number.isFinite(Date.parse(item.endDateTime)));
      await save(source, [{ id: "entra-timebound-roles", status: permanent ? "fail" : unknown ? "not_assessed" : "pass", securityPillar: "identity", summary: "Active assignment expiry for explicitly selected roles under the connection's time-bound-role policy. Does not attest PIM approval gates, group inheritance, eligibility or access reviews." }]);
    }
  }
}

export async function collectAuthorizationMatrix(context, profile) {
  const { identities = [], tests = [] } = profile.config;
  if (!tests.length) return;
  const baseline = new Set(), observations = [], anonymousBaseline = new Map();
  // An expired/invalid test credential must never make a negative test pass.
  for (const test of [...tests.filter(test => test.expect === "allow"), ...tests.filter(test => test.expect === "deny")]) {
    const url = new URL(test.url);
    if (url.origin !== context.target.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Matrix test left the approved origin or included unsafe URL components.");
    const identity = identities.find(identity => identity.id === test.identityId);
    if (!identity) throw new Error("Matrix test has no approved identity.");
    let status = "not_assessed", httpStatus = null;
    try {
      if (test.expect === "allow" && !anonymousBaseline.has(url.toString())) {
        const anonymous = await context.broker.fetch(url.toString());
        anonymousBaseline.set(url.toString(), [401, 403].includes(anonymous.status));
      }
      const response = await context.broker.fetch(url.toString(), { headers: { Authorization: `Bearer ${identity.token}` } });
      httpStatus = response.status;
      if (test.expect === "allow") { if (response.ok && anonymousBaseline.get(url.toString())) { baseline.add(identity.id); status = "pass"; } }
      else if (baseline.has(identity.id)) status = response.ok ? "fail" : response.status === 403 ? "pass" : "not_assessed";
    } catch { /* Missing transport evidence cannot pass; keep other tests. */ }
    observations.push({ id: "auth-test-matrix", status, securityPillar: "identity", assetId: `${url.origin}${url.pathname}`, identityId: identity.id,
      summary: `Approved GET authorization test (${test.expect}) for identity ${identity.id} at ${url.pathname}: HTTP ${httpStatus ?? "unavailable"}. Denial passes require an allow baseline that rejects anonymous access but accepts this identity, plus HTTP 403 on the denied route; 401/404/redirects are inconclusive. Response content was not retained.` });
  }
  await context.save({ layer: "authentication", source: context.target.origin, collectedAt: new Date().toISOString(), observations });
}
