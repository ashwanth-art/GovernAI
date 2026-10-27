import { createHash } from "node:crypto";

export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const fingerprint = value => createHash("sha256").update(canonical(value)).digest("hex");
export function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
export const identifier = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
