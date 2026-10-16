import type { AssessmentInput, AssessmentResult } from "./types";

export async function reviewRequest(path: string, options?: RequestInit) {
  const response = await fetch(`/api/reviews${path}`, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.errors?.join(" · ") || "Review service unavailable.");
  return body;
}

/** The browser is only an observer: reconnects never restart the worker. */
export async function watchReview(id: string, signal: AbortSignal, event: (name: string, data: Record<string, unknown>) => void, complete: (result: AssessmentResult) => void) {
  let cursor = 0;
  while (!signal.aborted) {
    const response = await fetch(`/api/reviews/${id}/events?after=${cursor}`, { signal });
    if (!response.ok || !response.body) throw new Error("Could not attach to the persisted review. Open Review history to reconnect.");
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "", terminal = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const chunks = pending.split("\n\n"); pending = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const sequence = chunk.match(/^id:\s*(\d+)$/m)?.[1];
          if (sequence) cursor = Number(sequence);
          const name = chunk.match(/^event:\s*(.+)$/m)?.[1], text = chunk.match(/^data:\s*(.+)$/m)?.[1];
          if (!name || !text) continue;
          const data = JSON.parse(text);
          if (name === "assessment_complete") { complete(data); terminal = true; }
          else { event(name, data); if (["assessment_error", "review_cancelled"].includes(name)) terminal = true; }
        }
        if (done || terminal) break;
      }
    } catch (error) {
      if (signal.aborted) throw error;
      event("review_progress", { message: "Connection interrupted. Reattaching to the running review…" });
    } finally { await reader.cancel().catch(() => {}); }
    if (terminal) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, 1500);
      const stop = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      signal.addEventListener("abort", stop, { once: true });
    });
  }
}

export const jsonOptions = (body: AssessmentInput | Record<string, unknown>): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
