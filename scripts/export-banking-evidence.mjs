#!/usr/bin/env node
/** Read-only bridge from bank-owned HTTP exports to the existing Tier 3 manifest.
 * Usage: node scripts/export-banking-evidence.mjs /absolute/path/sources.json
 * Credentials are resolved from configured environment-variable names.
 */
import { readFile } from "node:fs/promises";

const configPath = process.argv[2];
if (!configPath) throw new Error("Supply a banking source configuration JSON path.");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.sources)) throw new Error("sources must be an array.");
const procedures = {};
const atPath = (value, path) => path.split(".").reduce((item, part) => item?.[part], value);
for (const source of config.sources) {
  if (!/^artifact-bank-[a-z0-9-]+$/.test(source.procedureId)) throw new Error("Invalid banking procedure ID.");
  if (Object.hasOwn(procedures, source.procedureId)) throw new Error(`Duplicate source for ${source.procedureId}.`);
  const endpoint = new URL(source.url);
  if (endpoint.protocol !== "https:") throw new Error("Banking exporters require HTTPS source endpoints.");
  if (endpoint.username || endpoint.password) throw new Error("Use tokenEnv instead of URL credentials.");
  const headers = { accept: "application/json" };
  if (source.tokenEnv) {
    const token = process.env[source.tokenEnv];
    if (!token) throw new Error(`Missing credential environment variable ${source.tokenEnv}.`);
    headers.authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const record = await response.json();
    const measurements = {};
    for (const [field, path] of Object.entries(source.fieldPaths ?? {})) {
      const value = atPath(record, path);
      if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) measurements[field] = value;
    }
    procedures[source.procedureId] = {
      status: "not_assessed", // The assessment engine derives the verdict from measurements.
      summary: `Read-only ${source.provider ?? "bank-owned"} measurement export.`,
      collectedAt: source.collectedAtPath ? atPath(record, source.collectedAtPath) : new Date().toISOString(),
      artifactRef: `${endpoint.origin}${endpoint.pathname}`, measurements,
    };
  } catch {
    // Never include response bodies, tokens or credential-bearing URLs in errors.
    procedures[source.procedureId] = { status: "not_assessed", summary: "Source export unavailable; verify its authorization, URL and availability." };
  }
}
process.stdout.write(JSON.stringify({ schemaVersion: "1.0", generatedAt: new Date().toISOString(), procedures }, null, 2) + "\n");
