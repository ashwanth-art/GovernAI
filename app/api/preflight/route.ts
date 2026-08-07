import { credentialFields } from "@/lib/assessment";
import { safeDisplayUrl, writeExecutionLog } from "@/lib/execution-log";
import type { AccessTier } from "@/lib/types";

export const runtime = "edge";

/**
 * Connection pre-flight.
 *
 * The setup screen used to accept whatever was typed into it and defer every
 * verdict on reachability to the run. The result was that the first honest signal
 * about a wrong URL, a missing route or a rejected key arrived several seconds
 * into an assessment, wearing the costume of a control failure — and a
 * `not_assessed` for a typo is indistinguishable, on the report, from a
 * `not_assessed` for a genuinely unreachable system.
 *
 * This route answers the narrow question the setup screen actually needs: does
 * this location respond, and does the response look like the thing we expect. It
 * issues at most one request per field, all GET or HEAD, all reads, and it does
 * not evaluate a single control. Nothing it returns is evidence, and nothing it
 * returns is scored.
 */

const PROBE_TIMEOUT_MS = 6000;

/** Fields we know how to reach, and how to reach them. */
const REACHABLE: Record<
  string,
  {
    label: string;
    /** Derives the URL to try from the raw field value. */
    resolve: (value: string) => URL;
    method: "GET" | "HEAD";
    /** Whether the field's own key should be presented on the request. */
    authFrom?: string;
    /** What a successful response should look like, beyond a 2xx. */
    expectation?: string;
  }
> = {
  chatbotEndpoint: {
    label: "Health endpoint",
    resolve: (value) => new URL("/health", new URL(value).origin),
    method: "GET",
    expectation: "a JSON body reporting a status",
  },
  monitoringEndpoint: {
    label: "Monitoring summary",
    resolve: (value) => new URL("/api/monitoring/summary", new URL(value).origin),
    method: "GET",
    authFrom: "monitoringApiKey",
    expectation: "an authorized read of the monitoring adapter",
  },
  auditEndpoint: {
    label: "Audit configuration",
    resolve: (value) => new URL("/api/audit/config", new URL(value).origin),
    method: "GET",
    authFrom: "monitoringApiKey",
    expectation: "an authorized read of the audit adapter",
  },
  cicdUrl: { label: "Pipeline URL", resolve: (value) => new URL(value), method: "HEAD" },
  repoUrl: { label: "Source repository", resolve: (value) => new URL(value), method: "HEAD" },
  stagingUrl: { label: "Staging environment", resolve: (value) => new URL(value), method: "HEAD" },
  modelRegistryUrl: { label: "Model registry", resolve: (value) => new URL(value), method: "HEAD" },
  evidenceManifestUrl: {
    label: "Evidence manifest",
    resolve: (value) => new URL(value),
    method: "GET",
    expectation: "a JSON manifest listing named procedures",
  },
};

/** Fields the tier reads through the chatbot's own origin rather than a URL of their own. */
const DERIVED_FROM_CHATBOT = new Set(["monitoringEndpoint", "auditEndpoint"]);

export type LampState = "ok" | "warn" | "bad" | "off";

export interface PreflightResult {
  field: string;
  label: string;
  state: LampState;
  /** One short line, written to be shown next to the field. */
  note: string;
  url?: string;
  method?: string;
  httpStatus?: number;
  latencyMs?: number;
  /** Facts the response volunteered about the target's shape. Declared, not scored. */
  detected?: string[];
}

interface PreflightRequest {
  tier?: AccessTier;
  credentials?: Record<string, string>;
  /** Restrict the pre-flight to named fields. Omit to check every field the tier uses. */
  fields?: string[];
}

async function probe(
  url: URL,
  method: "GET" | "HEAD",
  apiKey?: string,
): Promise<{ ok: boolean; status: number; latencyMs: number; body?: unknown; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    const latencyMs = Date.now() - started;
    let body: unknown;
    if (method === "GET") {
      const text = await response.text();
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = undefined;
      }
    }
    return { ok: response.ok, status: response.status, latencyMs, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `No response within ${PROBE_TIMEOUT_MS / 1000}s`
          : "The host could not be reached",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a health body for facts about the target's architecture. Nothing here is a verdict. */
function detectFromHealth(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const found: string[] = [];
  const dependencies =
    record.dependencies && typeof record.dependencies === "object"
      ? (record.dependencies as Record<string, unknown>)
      : {};
  for (const [name, value] of Object.entries(dependencies)) {
    const healthy =
      value === true ||
      value === "ok" ||
      value === "healthy" ||
      (typeof value === "object" && value !== null && (value as Record<string, unknown>).status === "healthy");
    found.push(`${name}${healthy ? "" : " (degraded)"}`);
  }
  if (typeof record.version === "string") found.push(`version ${record.version}`);
  if (typeof record.model === "string") found.push(record.model);
  if (typeof record.vectorStore === "string") found.push(record.vectorStore);
  return found.slice(0, 8);
}

/** Reads a manifest body for the named procedures it declares. */
function detectFromManifest(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const entries = Array.isArray(record.procedures)
    ? record.procedures
    : Array.isArray(record.records)
      ? record.records
      : [];
  const ids = entries
    .map((entry) =>
      entry && typeof entry === "object"
        ? String((entry as Record<string, unknown>).procedureId ?? (entry as Record<string, unknown>).id ?? "")
        : "",
    )
    .filter(Boolean);
  return ids.length ? [`${ids.length} named procedure${ids.length === 1 ? "" : "s"}`, ...ids.slice(0, 5)] : [];
}

export async function POST(request: Request) {
  const started = Date.now();
  let body: PreflightRequest;
  try {
    body = (await request.json()) as PreflightRequest;
  } catch {
    return Response.json({ errors: ["Request body must be valid JSON."] }, { status: 400 });
  }

  const tier = ([1, 2, 3] as AccessTier[]).includes(body.tier as AccessTier)
    ? (body.tier as AccessTier)
    : 1;
  const credentials = body.credentials ?? {};
  const chatbotBase = credentials.chatbotEndpoint?.trim() ?? "";

  /* The tier's own field list decides what gets checked, so the pre-flight can
     never test something the run would not use. */
  const tierFieldKeys = new Set(credentialFields[tier].map((field) => field.key));
  const candidateKeys = Object.keys(REACHABLE).filter((key) => {
    if (body.fields?.length && !body.fields.includes(key)) return false;
    if (DERIVED_FROM_CHATBOT.has(key)) return tier >= 2 && Boolean(chatbotBase);
    return tierFieldKeys.has(key);
  });

  const results: PreflightResult[] = await Promise.all(
    candidateKeys.map(async (key): Promise<PreflightResult> => {
      const spec = REACHABLE[key];
      const raw = DERIVED_FROM_CHATBOT.has(key) ? chatbotBase : (credentials[key]?.trim() ?? "");
      if (!raw) {
        return { field: key, label: spec.label, state: "off", note: "Not supplied" };
      }

      let url: URL;
      try {
        url = spec.resolve(raw);
      } catch {
        return {
          field: key,
          label: spec.label,
          state: "bad",
          note: "That is not a URL we can resolve",
        };
      }

      const apiKey = spec.authFrom ? credentials[spec.authFrom]?.trim() : undefined;
      const outcome = await probe(url, spec.method, apiKey);
      const shared = {
        field: key,
        label: spec.label,
        url: safeDisplayUrl(url.toString()),
        method: spec.method,
        httpStatus: outcome.status || undefined,
        latencyMs: outcome.latencyMs,
      };

      if (outcome.error) {
        return { ...shared, state: "bad", note: outcome.error };
      }
      /* A 401 or 403 means the location is right and the key is not. That is a
         materially different state from "unreachable", and it is the one state a
         reader most often mistakes for a control failure, so it is named. */
      if (outcome.status === 401 || outcome.status === 403) {
        return {
          ...shared,
          state: "warn",
          note: apiKey
            ? "Responds, but rejected the key you supplied"
            : "Responds, but requires a key you have not supplied",
        };
      }
      if (outcome.status === 404) {
        return {
          ...shared,
          state: "warn",
          note: DERIVED_FROM_CHATBOT.has(key)
            ? "Host responds; this adapter route is not published"
            : "Host responds; that path does not exist",
        };
      }
      if (!outcome.ok) {
        return { ...shared, state: "warn", note: `Responded ${outcome.status}` };
      }

      const detected =
        key === "chatbotEndpoint"
          ? detectFromHealth(outcome.body)
          : key === "evidenceManifestUrl"
            ? detectFromManifest(outcome.body)
            : [];

      if (spec.expectation && spec.method === "GET" && outcome.body === undefined) {
        return {
          ...shared,
          state: "warn",
          note: `Responds ${outcome.status}, but not with ${spec.expectation}`,
        };
      }

      return {
        ...shared,
        state: "ok",
        note: `${outcome.status} in ${outcome.latencyMs} ms`,
        ...(detected.length ? { detected } : {}),
      };
    }),
  );

  const summary = {
    ok: results.filter((result) => result.state === "ok").length,
    warn: results.filter((result) => result.state === "warn").length,
    bad: results.filter((result) => result.state === "bad").length,
    off: results.filter((result) => result.state === "off").length,
  };

  writeExecutionLog({
    module: "app/api/preflight/route",
    functionName: "POST",
    executionStage: "connection_preflight",
    inputSummary: `tier=${tier}; fields=${candidateKeys.length}`,
    outputSummary: `${summary.ok} reachable; ${summary.warn} responding with a caveat; ${summary.bad} unreachable`,
    durationMs: Date.now() - started,
    status: summary.bad > 0 ? "warning" : "success",
  });

  return Response.json(
    { tier, results, summary, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
