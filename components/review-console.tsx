"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssessmentInput, AssessmentResult } from "@/lib/types";
import { jsonOptions, reviewRequest } from "@/lib/review-client";

const examples: Record<string, object> = {
  azure: { tenantId: "", clientId: "", clientSecret: "", subscriptionId: "", resourceGroup: "" },
  aws: { accountId: "", regions: ["ap-south-1"], accessKeyId: "", secretAccessKey: "", sessionToken: "", tagKey: "Application", tagValue: "", logGroupPrefix: "", alarmPrefix: "", trailArns: [] },
  github: { repository: "owner/repository", token: "" },
  auth: { url: "https://your-app.example/api/protected", token: "", forbiddenUrl: "" },
  documents: { url: "https://your-app.example/policy.txt", token: "", allowModel: false, asOf: "2026-10-16" },
  observability: { url: "https://your-app.example/api/review-export", token: "" },
  banking_export: { url: "https://your-app.example/api/banking-evidence", token: "" },
};
type Connection = { id: string; name: string; kind: string; targetOrigin: string };

export function ReviewConnections({ target }: { target: string }) {
  const [connections, setConnections] = useState<Connection[]>([]), [available, setAvailable] = useState(false);
  const [kind, setKind] = useState("azure"), [name, setName] = useState(""), [config, setConfig] = useState(JSON.stringify(examples.azure, null, 2));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { const data = await reviewRequest("/connections"); setConnections(data.connections); setAvailable(true); } catch { setAvailable(false); } }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  if (!available) return null;
  return <details className="review-panel"><summary>Optional read-only connections · {connections.length} saved</summary>
    <p>Public checks run without a profile. Add a scoped profile to inspect cloud resources, source code, authentication or governance records. Profiles are encrypted, isolated to this browser session and pinned to the target origin. Use a dedicated read-only identity; never paste administrator credentials.</p>
    {connections.map(connection => <div className="review-row" key={connection.id}><span>{connection.name} · {connection.kind}<small>{connection.targetOrigin}</small></span><button className="btn quiet" type="button" onClick={async () => { try { await reviewRequest(`/connections/${connection.id}`, { method: "DELETE" }); await load(); } catch (e) { setError(String(e)); } }}>Remove</button></div>)}
    <div className="fields two"><label className="field"><span>Connection name</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
      <label className="field"><span>Connection type</span><select value={kind} onChange={e => { setKind(e.target.value); setConfig(JSON.stringify(examples[e.target.value], null, 2)); }}>{Object.keys(examples).map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
    <label className="field"><span>Configuration JSON · secret fields are never returned</span><textarea aria-label="Read-only connection configuration" rows={10} value={config} onChange={e => setConfig(e.target.value)} autoComplete="off" spellCheck={false} /></label>
    <p className="faint">Target: {target}. Document text is sent to a model only when allowModel is explicitly true. Exports must include actual control evidence; availability alone is not a pass.</p>
    <button className="btn" type="button" disabled={busy || !name.trim()} onClick={async () => { setBusy(true); setError(""); try { await reviewRequest("/connections", jsonOptions({ name, kind, targetOrigin: new URL(target).origin, config: JSON.parse(config) })); setConfig(JSON.stringify(examples[kind], null, 2)); setName(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>Save encrypted connection</button>
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}

type Job = { id: string; status: string; created_at: string; error?: string; summary: { systemName: string; tier: number; stage: string } };
type Schedule = { id: string; enabled: boolean; interval_seconds: number; next_due: string };
export function ReviewHistory({ input, onOpen, onResume }: { input: AssessmentInput; onOpen: (result: AssessmentResult) => void; onResume: (id: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]), [schedules, setSchedules] = useState<Schedule[]>([]), [error, setError] = useState("");
  const load = useCallback(async () => { try { const [history, scheduled] = await Promise.all([reviewRequest(""), reviewRequest("/schedules")]); setJobs(history.jobs); setSchedules(scheduled.schedules); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }, []);
  useEffect(() => { const first = setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 10000); return () => { clearTimeout(first); clearInterval(timer); }; }, [load]);
  const action = async (work: () => Promise<void>) => { try { await work(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <div className="review-history"><p className="eyebrow">Persistent review workspace</p><h1>Review history</h1><p>Reviews continue on the server when this tab closes. Evidence and outcomes are encrypted and retained across deployments. In demo mode, access is tied to this browser’s signed session cookie, not an enterprise account.</p>
    {error ? <p role="alert" className="because warn">{error}</p> : null}
    <button className="btn" type="button" onClick={() => void load()}>Refresh history</button>
    {jobs.length ? jobs.map(job => <article className="review-row" key={job.id}><span><strong>{job.summary.systemName}</strong><small>{new Date(job.created_at).toLocaleString()} · Tier {job.summary.tier} · {job.status}</small><small>{job.error || job.summary.stage}</small></span>
      {job.status === "completed" ? <button className="btn" type="button" onClick={() => void action(async () => onOpen((await reviewRequest(`/${job.id}`)).result))}>Open saved report</button> : ["queued", "running"].includes(job.status) ? <><button className="btn" type="button" onClick={() => onResume(job.id)}>Watch review</button><button className="btn quiet" type="button" onClick={() => void action(async () => { await reviewRequest(`/${job.id}/cancel`, { method: "POST" }); })}>Cancel</button></> : null}
    </article>) : <p>No saved reviews in this session yet.</p>}
    <h2>Scheduled reviews</h2><p>Uses the current setup and saved target-scoped connections. Credentials needed for scheduled reads are encrypted until the schedule is disabled. Minimum interval: 15 minutes.</p>
    <button className="btn" type="button" onClick={() => void action(async () => { await reviewRequest("/schedules", jsonOptions({ input, intervalSeconds: 86400 })); })}>Schedule current setup daily</button>
    {schedules.filter(item => item.enabled).map(item => <div className="review-row" key={item.id}><span>Every {item.interval_seconds / 3600} hours<small>Next: {new Date(item.next_due).toLocaleString()}</small></span><button className="btn quiet" type="button" onClick={() => void action(async () => { await reviewRequest(`/schedules/${item.id}`, { method: "DELETE" }); })}>Disable schedule</button></div>)}
  </div>;
}

export function ReviewEvidence({ result }: { result: AssessmentResult }) {
  const review = result.review;
  if (!review) return null;
  return <details className="review-panel"><summary>Deployment review evidence · {review.evidence.length} records · {review.assets.length} assets</summary>
    <p>Rules evaluate observed configuration. Model reviews cannot change a control verdict without a verified, fresh source citation. Unconnected layers are not proof of compliance.</p>
    <p>{review.toolCalls} brokered reads · {review.rounds} collection round(s) · {review.connectionCount} scoped connection(s)</p>
    <p>Layers collected: {review.layers.map(layer => layer.layer).join(", ")}. Connections not configured: {review.connectionsNotConfigured.join(", ") || "none"}.</p>
    <p>Evidence coverage before the pass/fail-only report filter: {review.originalCoverage.evaluated}/{review.originalCoverage.total} controls. {review.unresolved.length} controls still lack sufficient evidence.</p>
    {review.modelReviews.map((model, i) => <p key={i}>{model.model ?? model.role ?? "Model review"}: {model.summary ?? model.reason ?? model.status}</p>)}
    <ul>{review.evidence.map(record => <li key={record.id}>{record.layer} · {record.source}<small className="review-hash">{record.collectedAt} · SHA-256 {record.hash}</small></li>)}</ul>
    <a className="btn" href={`/api/reviews/${review.jobId}/evidence`} target="_blank" rel="noreferrer">Open source observations</a>
  </details>;
}
