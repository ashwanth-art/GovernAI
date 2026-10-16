/** Parse the existing AWS-generated report, never request its generation (a
 * write). Only explicitly selected users are evaluated or retained as evidence.
 */
export function parseCredentialReport(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && (char === "," || char === "\n")) { row.push(field.replace(/\r$/, "")); field = ""; if (char === "\n") { rows.push(row); row = []; } }
    else field += char;
  }
  if (quoted) throw new Error("Malformed AWS credential report.");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  if (!headers.includes("user") || !headers.includes("mfa_active")) throw new Error("AWS credential report is missing required headers.");
  return rows.filter(row => row.length === headers.length).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

export function credentialObservations(report, config, now = Date.now()) {
  const generated = Date.parse(report.GeneratedTime);
  if (!Number.isFinite(generated) || generated > now + 300000 || now - generated > 86400000) return [{ id: "aws-iam-console-mfa", status: "not_assessed", securityPillar: "identity", summary: "Existing AWS credential report is unavailable or older than 24 hours; the read-only collector will not generate a new one." }];
  const rows = parseCredentialReport(Buffer.from(report.Content ?? []).toString("utf8"));
  const observations = [];
  for (const name of config.iamUserNames) {
    const row = rows.find(row => row.user === name), assetId = `arn:aws:iam::${config.accountId}:user/${name}`;
    const add = (id, status, summary) => observations.push({ id, status, summary, assetId, securityPillar: "identity", measuredAt: new Date(generated).toISOString() });
    if (!row) { add("aws-iam-console-mfa", "not_assessed", "Explicit IAM user is absent from the existing credential report."); continue; }
    add("aws-iam-console-mfa", row.password_enabled !== "true" ? "not_assessed" : row.mfa_active === "true" ? "pass" : row.mfa_active === "false" ? "fail" : "not_assessed", "MFA configured for the scoped console-enabled IAM user; this does not establish per-request MFA enforcement or IAM Identity Center coverage.");
    const ageStates = [], idleStates = [];
    for (const key of [1, 2]) {
      const active = row[`access_key_${key}_active`];
      if (active === "false") continue;
      if (active !== "true") { ageStates.push("not_assessed"); idleStates.push("not_assessed"); continue; }
      const rotated = Date.parse(row[`access_key_${key}_last_rotated`]), lastUsed = Date.parse(row[`access_key_${key}_last_used_date`]);
      const state = (date, threshold) => !Number.isFinite(date) || date > now + 300000 || !Number.isSafeInteger(threshold) || threshold < 1 ? "not_assessed" : now - date > threshold * 86400000 ? "fail" : "pass";
      ageStates.push(state(rotated, config.maximumCredentialAgeDays));
      idleStates.push(state(lastUsed, config.maximumCredentialIdleDays));
    }
    const worst = states => !states.length ? "not_assessed" : states.includes("fail") ? "fail" : states.includes("not_assessed") ? "not_assessed" : "pass";
    add("aws-iam-key-age", worst(ageStates), `Scoped active access-key rotation age compared with configured ${config.maximumCredentialAgeDays}-day policy; no access-key identifiers retained.`);
    add("aws-iam-unused-credentials", worst(idleStates), `Scoped active access-key last use compared with configured ${config.maximumCredentialIdleDays}-day policy. Missing activity timestamps are inconclusive, not assumed unused.`);
  }
  return observations;
}
