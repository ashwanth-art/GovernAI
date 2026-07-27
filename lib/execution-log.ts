type LogStatus = "running" | "success" | "warning" | "failure";

export interface StructuredExecutionLog {
  timestamp?: string;
  module: string;
  functionName: string;
  executionStage: string;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  status: LogStatus;
  errorDetails?: string;
}

const sensitiveValuePattern =
  /(sk-(?:proj-)?[a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]+|api[_ -]?key\s*[:=]\s*\S+|password\s*[:=]\s*\S+|token\s*[:=]\s*\S+)/gi;

export function redactLogText(value: unknown): string {
  return String(value ?? "")
    .replace(sensitiveValuePattern, "[REDACTED]")
    .slice(0, 1_000);
}

export function safeDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactLogText(value);
  }
}

export function writeExecutionLog(entry: StructuredExecutionLog) {
  const safeEntry: StructuredExecutionLog & { timestamp: string } = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    module: redactLogText(entry.module),
    functionName: redactLogText(entry.functionName),
    executionStage: redactLogText(entry.executionStage),
    inputSummary: redactLogText(entry.inputSummary),
    outputSummary: redactLogText(entry.outputSummary),
    durationMs: Math.max(0, Number(entry.durationMs) || 0),
    status: entry.status,
    ...(entry.errorDetails ? { errorDetails: redactLogText(entry.errorDetails) } : {}),
  };
  console.info(JSON.stringify(safeEntry));
}
