/** Activates an already-provisioned review store with HTTP readiness gating.
 * Only the named demo resources are modified. Secret values never reach stdout.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
const run = promisify(execFile), group = "rg-governai-demo", app = "governai";
const release = process.env.REVIEW_RELEASE || "20261016.6";
if (!/^\d{8}\.\d+$/.test(release)) throw new Error("Release must be a dated image tag.");
async function az(...args) {
  try { const { stdout } = await run("az", [...args, "--only-show-errors", "-o", "json"], { maxBuffer: 8e6 }); return stdout.trim() ? JSON.parse(stdout) : null; }
  catch { throw new Error(`Azure operation failed: ${args.slice(0, 3).join(" ")}. Secret arguments suppressed.`); }
}
try {
  const secrets = await az("containerapp", "secret", "list", "-g", group, "-n", app, "--show-values");
  const database = secrets.find(secret => secret.name === "review-database-url")?.value;
  if (!database) throw new Error("Provision the dedicated review database first.");
  const url = new URL(database);
  if (url.username === "reviewadmin") {
    const password = randomBytes(36).toString("base64url"), root = new URL(url); root.searchParams.delete("sslmode");
    const admin = new Pool({ connectionString: root.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 20000 });
    try {
      const existing = await admin.query("SELECT 1 FROM pg_roles WHERE rolname='arq_review_app'");
      await admin.query(`${existing.rowCount ? "ALTER ROLE arq_review_app" : "CREATE ROLE arq_review_app LOGIN"} PASSWORD '${password}'`);
      await admin.query("CREATE SCHEMA IF NOT EXISTS arq_review AUTHORIZATION arq_review_app");
      await admin.query("GRANT CONNECT ON DATABASE postgres TO arq_review_app");
      url.username = "arq_review_app"; url.password = password;
      await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-database-url=${url.toString()}`);
    } finally { await admin.end(); }
  }
  if (url.username !== "arq_review_app") throw new Error("Refusing an unexpected database identity.");
  const connection = await az("storage", "account", "show-connection-string", "-g", group, "-n", "stgovernaireview");
  await az("storage", "container", "create", "--name", "review-evidence", "--connection-string", connection.connectionString);
  await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-storage-connection=${connection.connectionString}`);
  try { process.loadEnvFile(".env"); } catch { /* CI may inject its secret instead. */ }
  if (process.env.OPENAI_API_KEY) await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-model-key=${process.env.OPENAI_API_KEY}`);
  const current = await az("containerapp", "show", "-g", group, "-n", app), template = current.properties.template;
  template.revisionSuffix = release.replace(".", "-");
  template.scale = { ...template.scale, minReplicas: 1 };
  const container = template.containers.find(item => item.name === app);
  if (!container) throw new Error("The expected application container was not found.");
  container.image = `acrgovernaidemo.azurecr.io/governai:${release}`;
  const values = {
    REVIEW_DATABASE_URL: { secretRef: "review-database-url" }, REVIEW_ENCRYPTION_KEY: { secretRef: "review-encryption-key" },
    REVIEW_SESSION_KEY: { secretRef: "review-session-key" }, REVIEW_STORAGE_CONNECTION_STRING: { secretRef: "review-storage-connection" },
    REVIEW_EVIDENCE_CONTAINER: { value: "review-evidence" }, REVIEW_MODEL_SMALL: { value: "gpt-4.1-mini" }, REVIEW_MODEL_COMPLEX: { value: "gpt-4.1" },
    ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: { secretRef: "review-model-key" } } : {}),
  };
  container.env = [...(container.env || []).filter(item => !(item.name in values)), ...Object.entries(values).map(([name, value]) => ({ name, ...value }))];
  container.probes = [
    { type: "Startup", tcpSocket: { port: 8080 }, initialDelaySeconds: 3, periodSeconds: 5, failureThreshold: 60, timeoutSeconds: 3 },
    { type: "Readiness", httpGet: { path: "/api/reviews/health", port: 8080, scheme: "HTTP" }, initialDelaySeconds: 3, periodSeconds: 5, failureThreshold: 30, timeoutSeconds: 3 },
  ];
  const access = await az("account", "get-access-token", "--resource", "https://management.azure.com/");
  const response = await fetch(`https://management.azure.com${current.id}?api-version=2026-07-01`, { method: "PATCH", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ location: current.location, properties: { template } }) });
  if (!response.ok) {
    const failure = await response.json();
    let message = String(failure.error?.message || failure.message || JSON.stringify(failure));
    for (const secret of secrets) if (secret.value) message = message.replaceAll(secret.value, "[secret suppressed]");
    throw new Error(`Revision activation failed (HTTP ${response.status}): ${message.slice(0, 1500)}`);
  }
  console.log(`Submitted governai--${template.revisionSuffix}; traffic is readiness-gated on the persistent review service.`);
} catch (error) { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[database URL suppressed]") : "Review activation failed."); process.exitCode = 1; }
