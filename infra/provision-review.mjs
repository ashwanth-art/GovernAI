/** Creates isolated review persistence in the existing demo resource group.
 * Secrets go directly to Container Apps secrets; never print command arguments.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
const run = promisify(execFile);
const group = "rg-governai-demo";
const app = "governai";
const pgName = "pg-governai-review";
const storage = "stgovernaireview";
async function az(...args) {
  try { const { stdout } = await run("az", [...args, "--only-show-errors", "-o", "json"], { maxBuffer: 8e6 }); return stdout.trim() ? JSON.parse(stdout) : null; }
  catch (error) {
    let detail = String(error.stderr || "No diagnostic returned.");
    for (let i = 0; i < args.length; i++) if (/password|connection-string|--secrets/.test(args[i])) detail = detail.replaceAll(args[i + 1] || "__absent__", "[redacted]");
    throw new Error(`Azure operation failed: ${args.slice(0, 3).join(" ")}. ${detail.slice(0, 1400)}`);
  }
}
const current = await az("containerapp", "show", "-g", group, "-n", app);
let database = await az("postgres", "flexible-server", "list", "-g", group);
let db = database.find(item => item.name === pgName);
if (!db) {
  console.log("Creating managed PostgreSQL review store (Burstable B1ms, 32 GiB, seven-day backup).");
  const password = randomBytes(36).toString("base64url");
  db = await az("postgres", "flexible-server", "create", "-g", group, "-n", pgName, "-l", "centralindia", "--tier", "Burstable", "--sku-name", "Standard_B1ms", "--storage-size", "32", "--version", "16", "--admin-user", "reviewadmin", "--admin-password", password, "--public-access", "None", "--backup-retention", "7", "--yes");
  await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-database-url=postgresql://reviewadmin:${encodeURIComponent(password)}@${pgName}.postgres.database.azure.com:5432/postgres?sslmode=verify-full`, `review-encryption-key=${randomBytes(32).toString("hex")}`, `review-session-key=${randomBytes(32).toString("hex")}`);
}
console.log("Restricting database ingress to the app's documented outbound IPs.");
if (db.network?.publicNetworkAccess !== "Enabled") await az("postgres", "flexible-server", "update", "-g", group, "-n", pgName, "--public-access", "Enabled");
const addresses = current.properties.outboundIpAddresses ?? [];
if (!addresses.length) throw new Error("No application egress IPs discovered; database remains closed.");
const identity = await az("account", "show");
const access = await az("account", "get-access-token", "--resource", "https://management.azure.com/");
const present = new Set((await az("postgres", "flexible-server", "firewall-rule", "list", "-g", group, "-n", pgName)).map(rule => rule.name));
async function firewall(name, ip) {
  if (present.has(name)) return;
  const url = `https://management.azure.com/subscriptions/${identity.id}/resourceGroups/${group}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${pgName}/firewallRules/${name}?api-version=2024-08-01`;
  const response = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ properties: { startIpAddress: ip, endIpAddress: ip } }) });
  if (!response.ok) throw new Error(`Scoped firewall update failed (HTTP ${response.status}).`);
}
for (let index = 0; index < addresses.length; index += 10) {
  await Promise.all(addresses.slice(index, index + 10).map((ip, offset) => firewall(`review-app-${index + offset}`, ip)));
}
const ip = (await (await fetch("https://api.ipify.org")).text()).trim();
if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("Could not identify the provisioning machine's IPv4 address.");
await firewall("review-provisioner", ip);
console.log("Waiting for scoped database firewall updates to become effective.");
for (let attempt = 0; attempt < 60; attempt++) {
  const rules = await az("postgres", "flexible-server", "firewall-rule", "list", "-g", group, "-n", pgName);
  if (rules.some(rule => rule.name === "review-provisioner") && rules.length >= addresses.length + 1) break;
  if (attempt === 59) throw new Error("Scoped firewall updates are still pending. Re-run provisioning after Azure finishes them.");
  await new Promise(resolve => setTimeout(resolve, 5000));
}
const secrets = await az("containerapp", "secret", "list", "-g", group, "-n", app, "--show-values");
const databaseUrl = secrets.find(item => item.name === "review-database-url")?.value;
if (!databaseUrl) throw new Error("The database bootstrap secret is unavailable; do not reset credentials automatically.");
if (new URL(databaseUrl).username === "reviewadmin") {
  const rootUrl = new URL(databaseUrl); rootUrl.searchParams.delete("sslmode");
  const admin = new Pool({ connectionString: rootUrl.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 20000 });
  const password = randomBytes(36).toString("base64url");
  try {
    const existing = await admin.query("SELECT 1 FROM pg_roles WHERE rolname='arq_review_app'");
    if (existing.rowCount) await admin.query(`ALTER ROLE arq_review_app PASSWORD '${password}'`);
    else await admin.query(`CREATE ROLE arq_review_app LOGIN PASSWORD '${password}'`);
    await admin.query("CREATE SCHEMA IF NOT EXISTS arq_review AUTHORIZATION arq_review_app");
    await admin.query("GRANT CONNECT ON DATABASE postgres TO arq_review_app");
    await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-database-url=postgresql://arq_review_app:${encodeURIComponent(password)}@${pgName}.postgres.database.azure.com:5432/postgres?sslmode=verify-full`);
  } finally { await admin.end(); }
}
let accounts = await az("storage", "account", "list", "-g", group);
if (!accounts.some(item => item.name === storage)) {
  console.log("Creating private evidence object storage.");
  await az("storage", "account", "create", "-g", group, "-n", storage, "-l", "centralindia", "--sku", "Standard_LRS", "--kind", "StorageV2", "--min-tls-version", "TLS1_2", "--allow-blob-public-access", "false", "--https-only", "true");
}
const connection = await az("storage", "account", "show-connection-string", "-g", group, "-n", storage);
await az("storage", "container", "create", "--name", "review-evidence", "--connection-string", connection.connectionString);
await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-storage-connection=${connection.connectionString}`);
try { process.loadEnvFile(".env"); } catch { /* Environment may already be supplied by a secret manager. */ }
const modelEnv = [];
if (process.env.OPENAI_API_KEY) {
  await az("containerapp", "secret", "set", "-g", group, "-n", app, "--secrets", `review-model-key=${process.env.OPENAI_API_KEY}`);
  modelEnv.push("OPENAI_API_KEY=secretref:review-model-key", "REVIEW_MODEL_SMALL=gpt-4.1-mini", "REVIEW_MODEL_COMPLEX=gpt-4.1");
}
await az("containerapp", "update", "-g", group, "-n", app, "--min-replicas", "1", "--set-env-vars", "REVIEW_DATABASE_URL=secretref:review-database-url", "REVIEW_ENCRYPTION_KEY=secretref:review-encryption-key", "REVIEW_SESSION_KEY=secretref:review-session-key", "REVIEW_STORAGE_CONNECTION_STRING=secretref:review-storage-connection", "REVIEW_EVIDENCE_CONTAINER=review-evidence", ...modelEnv);
console.log("Review persistence provisioned. Database ingress is scoped; storage and credentials are private.");
