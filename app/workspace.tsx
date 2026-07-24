"use client";

import { useMemo, useState } from "react";
import { credentialFields } from "@/lib/assessment";
import { industries, standardById, standards, tierCoverageLabel } from "@/lib/catalog";
import type {
  AccessTier,
  AssessmentInput,
  AssessmentResult,
  ControlStatus,
  Pillar,
  StandardReport,
} from "@/lib/types";

const steps = [
  { number: "01", title: "Define scope", description: "System and RAG architecture" },
  { number: "02", title: "Select standards", description: "Choose exactly what runs" },
  { number: "03", title: "Set access tier", description: "Match evidence depth" },
  { number: "04", title: "Review & evaluate", description: "Validate and launch" },
];

const pillarLabels: Record<Pillar, string> = {
  trust: "Trust",
  security: "Security",
  governance: "Governance",
  compliance: "Compliance",
  data_protection: "Data Protection",
};

const tierDetails: Array<{
  tier: AccessTier;
  title: string;
  coverage: string;
  subtitle: string;
  features: string[];
}> = [
  {
    tier: 1,
    title: "Black-box",
    coverage: "55–60%",
    subtitle: "API-only evaluation",
    features: ["Adversarial probes", "Leakage and injection tests", "Groundedness checks"],
  },
  {
    tier: 2,
    title: "Gray-box",
    coverage: "80–85%",
    subtitle: "API + infrastructure",
    features: ["Everything in Tier 1", "Cloud and logging checks", "CI/CD and encryption review"],
  },
  {
    tier: 3,
    title: "White-box",
    coverage: "100%",
    subtitle: "Source + staging",
    features: ["Everything in Tier 2", "Source and dependency review", "Corpus and model-card audit"],
  },
];

const emptyInput: AssessmentInput = {
  organization: "",
  systemName: "",
  industryId: "healthcare",
  standardIds: ["hipaa", "iso42001", "nist_ai_rmf"],
  tier: 1,
  credentials: {},
  architecture: {
    modelProvider: "",
    modelName: "",
    vectorDatabase: "",
    embeddingModel: "",
  },
};

function statusLabel(status: ControlStatus) {
  return status === "not_assessed"
    ? "Not assessed"
    : status.charAt(0).toUpperCase() + status.slice(1);
}

function StatusBadge({ status }: { status: ControlStatus }) {
  return <span className={`status status-${status}`}>{statusLabel(status)}</span>;
}

function loadDemoInput(): AssessmentInput {
  return {
    organization: "Northstar Health",
    systemName: "Clinical Knowledge Assistant",
    industryId: "healthcare",
    standardIds: ["hipaa", "iso42001", "nist_ai_rmf"],
    tier: 2,
    credentials: {
      chatbotEndpoint: "https://api.example.com/v1/rag/chat",
      chatbotApiKey: "demo-key-not-transmitted-externally",
      cloudProvider: "AWS",
      cloudApiKey: "demo-read-only-cloud-key",
      monitoringProvider: "Datadog",
      monitoringApiKey: "demo-monitoring-key",
      cicdUrl: "https://github.com/example/rag/actions",
    },
    architecture: {
      modelProvider: "Anthropic",
      modelName: "Claude",
      vectorDatabase: "Pinecone",
      embeddingModel: "text-embedding-3-large",
    },
  };
}

function parseEventBlock(block: string) {
  let name = "message";
  let data = "";
  block.split("\n").forEach((line) => {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  });
  return { name, data: data ? JSON.parse(data) : null };
}

function createReportHtml(result: AssessmentResult, report?: StandardReport) {
  const selected = report ? [report] : result.reports;
  const reportsHtml = selected
    .map(
      (item) => `
      <section>
        <h2>${item.shortName} — ${item.name}</h2>
        <p><strong>Version:</strong> ${item.version}</p>
        <p><strong>Assessment result:</strong> ${item.score}% · ${item.readiness}</p>
        <p><strong>Native scoring:</strong> ${item.scoringMethod}</p>
        <p><strong>Pass threshold:</strong> ${item.passThreshold}</p>
        <h3>Report structure</h3>
        <ol>${item.nativeSections.map((section) => `<li>${section}</li>`).join("")}</ol>
        <h3>Control evidence</h3>
        <table><thead><tr><th>Control</th><th>Status</th><th>Evidence</th><th>Remediation</th></tr></thead>
        <tbody>${item.controls
          .map(
            (control) =>
              `<tr><td>${control.id} — ${control.name}</td><td>${statusLabel(control.status)}</td><td>${control.evidence}</td><td>${control.status === "pass" ? "—" : control.remediation}</td></tr>`,
          )
          .join("")}</tbody></table>
      </section>`,
    )
    .join("");
  return `<!doctype html><html><head><title>${result.scope.systemName} Governance Report</title>
    <style>body{font-family:Arial,sans-serif;color:#172126;max-width:1000px;margin:40px auto;line-height:1.5}h1{font-size:30px}h2{margin-top:40px;border-bottom:2px solid #1c6255;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ccd7d3;padding:8px;text-align:left;vertical-align:top}th{background:#edf4f1}@media print{body{margin:16mm}section{break-before:page}section:first-of-type{break-before:auto}}</style>
    </head><body><h1>GovernAI RAG Compliance Assessment</h1>
    <p><strong>${result.scope.organization}</strong> · ${result.scope.systemName}<br/>Assessment ${result.assessmentId} · Tier ${result.scope.tier} · ${new Date(result.generatedAt).toLocaleString()}</p>
    ${reportsHtml}<script>window.onload=()=>window.print()</script></body></html>`;
}

export function AssessmentWorkspace() {
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<AssessmentInput>(emptyInput);
  const [standardSearch, setStandardSearch] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<Array<{ name: string; data: Record<string, unknown> }>>([]);
  const [activeTab, setActiveTab] = useState("progress");

  const industry = industries.find((item) => item.id === input.industryId)!;
  const visibleStandards = useMemo(() => {
    const query = standardSearch.trim().toLowerCase();
    const recommended = new Set(industry.recommendations.map((item) => item.standardId));
    return standards
      .filter(
        (item) =>
          !query ||
          item.shortName.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query) ||
          item.jurisdiction.toLowerCase().includes(query),
      )
      .sort((a, b) => Number(recommended.has(b.id)) - Number(recommended.has(a.id)));
  }, [industry, standardSearch]);

  const selectedDefinitions = input.standardIds
    .map((id) => standardById.get(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof standardById.get>>[];

  function patchInput(patch: Partial<AssessmentInput>) {
    setInput((current) => ({ ...current, ...patch }));
    setErrors([]);
  }

  function chooseIndustry(industryId: string) {
    const nextIndustry = industries.find((item) => item.id === industryId)!;
    patchInput({
      industryId,
      standardIds: nextIndustry.recommendations.map((item) => item.standardId),
    });
  }

  function toggleStandard(standardId: string) {
    const selected = input.standardIds.includes(standardId);
    if (!selected && input.standardIds.length === 3) {
      setErrors(["A maximum of 3 standards can be selected. Remove one before adding another."]);
      return;
    }
    patchInput({
      standardIds: selected
        ? input.standardIds.filter((id) => id !== standardId)
        : [...input.standardIds, standardId],
    });
  }

  function validateStep(index: number) {
    const nextErrors: string[] = [];
    if (index === 0) {
      if (!input.organization.trim()) nextErrors.push("Enter the organization name.");
      if (!input.systemName.trim()) nextErrors.push("Enter the AI system name.");
      if (!input.architecture.modelProvider.trim()) nextErrors.push("Enter the model provider.");
      if (!input.architecture.modelName.trim()) nextErrors.push("Enter the model name.");
      if (!input.architecture.vectorDatabase.trim()) {
        nextErrors.push("Enter the vector database to confirm this is a RAG system.");
      }
      if (!input.architecture.embeddingModel.trim()) nextErrors.push("Enter the embedding model.");
    }
    if (index === 1 && (input.standardIds.length < 1 || input.standardIds.length > 3)) {
      nextErrors.push("Select between 1 and 3 standards.");
    }
    if (index === 2) {
      credentialFields[input.tier].forEach((field) => {
        const value = input.credentials[field.key]?.trim();
        if (!value) nextErrors.push(`${field.label} is required for Tier ${input.tier}.`);
        if (field.type === "url" && value) {
          try {
            if (new URL(value).protocol !== "https:") nextErrors.push(`${field.label} must use HTTPS.`);
          } catch {
            nextErrors.push(`${field.label} must be a valid URL.`);
          }
        }
      });
    }
    setErrors([...new Set(nextErrors)]);
    return nextErrors.length === 0;
  }

  function nextStep() {
    if (validateStep(step)) setStep((current) => Math.min(current + 1, 3));
  }

  async function runEvaluation() {
    if (!validateStep(2)) {
      setStep(2);
      return;
    }
    setRunning(true);
    setResult(null);
    setEvents([]);
    setActiveTab("progress");
    setErrors([]);
    try {
      const response = await fetch("/api/assessments/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const body = (await response.json()) as { errors?: string[] };
        throw new Error(body.errors?.join("\n") || "Assessment could not be started.");
      }
      if (!response.body) throw new Error("Live assessment stream was unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        blocks.filter(Boolean).forEach((block) => {
          const parsed = parseEventBlock(block);
          if (parsed.name === "assessment_complete") {
            setResult(parsed.data as AssessmentResult);
          } else {
            setEvents((current) => [
              ...current.slice(-119),
              { name: parsed.name, data: parsed.data as Record<string, unknown> },
            ]);
          }
        });
        if (done) break;
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Assessment failed."]);
    } finally {
      setRunning(false);
    }
  }

  function printReport(report?: StandardReport) {
    if (!result) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setErrors(["Pop-ups are blocked. Allow pop-ups to print or save this report as PDF."]);
      return;
    }
    printWindow.document.write(createReportHtml(result, report));
    printWindow.document.close();
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${result.assessmentId}-evidence-package.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  const completedControls = events.filter((item) => item.name === "control_result").length;
  const totalControls = selectedDefinitions.reduce((sum, item) => sum + item.controls.length, 0);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="GovernAI home">
          <span className="brand-mark" aria-hidden="true">G</span>
          <span>Govern<span>AI</span></span>
        </a>
        <div className="topbar-meta">
          <span className="system-status"><i /> Assessment engine online</span>
          <span className="divider" />
          <span>Standard-driven RAG assurance</span>
        </div>
      </header>

      <div className="workspace">
        <aside className="rail">
          <div className="rail-intro">
            <p className="eyebrow">New assessment</p>
            <h1>Evaluate only what matters.</h1>
            <p>Choose your obligations. GovernAI loads exactly those control packs—nothing unrequested.</p>
          </div>
          <nav className="steps" aria-label="Assessment steps">
            {steps.map((item, index) => (
              <button
                className={`step ${index === step ? "active" : ""} ${index < step ? "complete" : ""}`}
                key={item.number}
                type="button"
                onClick={() => {
                  if (index <= step || validateStep(step)) setStep(index);
                }}
              >
                <span className="step-number">{index < step ? "✓" : item.number}</span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </nav>
          <div className="assurance-note">
            <span aria-hidden="true">◆</span>
            <div><strong>Evidence remains scoped</strong><p>Credentials are used only for the active request and never appear in reports.</p></div>
          </div>
        </aside>

        <section className="main-panel">
          {!result && (
            <>
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step {step + 1} of 4</p>
                  <h2>{steps[step].title}</h2>
                  <p>
                    {step === 0 && "Identify the system and confirm its retrieval-augmented architecture."}
                    {step === 1 && "Recommendations follow your industry; you stay in control of the final scope."}
                    {step === 2 && "Higher tiers unlock deeper evidence without changing which standards run."}
                    {step === 3 && "Confirm the exact scope before launching parallel standard engines."}
                  </p>
                </div>
                <button className="text-button" type="button" onClick={() => setInput(loadDemoInput())}>
                  Load demo assessment
                </button>
              </div>

              {errors.length > 0 && (
                <div className="error-box" role="alert">
                  <strong>Check the required information</strong>
                  <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
                </div>
              )}

              {step === 0 && (
                <div className="form-stack">
                  <div className="field-grid two">
                    <label className="field">
                      <span>Organization <b>*</b></span>
                      <input
                        value={input.organization}
                        onChange={(event) => patchInput({ organization: event.target.value })}
                        placeholder="e.g. Northstar Health"
                      />
                    </label>
                    <label className="field">
                      <span>AI system name <b>*</b></span>
                      <input
                        value={input.systemName}
                        onChange={(event) => patchInput({ systemName: event.target.value })}
                        placeholder="e.g. Clinical Knowledge Assistant"
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Industry <b>*</b></span>
                    <select value={input.industryId} onChange={(event) => chooseIndustry(event.target.value)}>
                      {industries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <small>{industry.description}</small>
                  </label>
                  <div className="section-label">
                    <span>RAG architecture</span>
                    <em>Required to distinguish RAG from a plain LLM wrapper</em>
                  </div>
                  <div className="field-grid two">
                    {[
                      ["modelProvider", "Model provider", "Anthropic, OpenAI, Bedrock…"],
                      ["modelName", "Model name", "Production model identifier"],
                      ["vectorDatabase", "Vector database", "Pinecone, Weaviate, pgvector…"],
                      ["embeddingModel", "Embedding model", "Embedding model identifier"],
                    ].map(([key, label, placeholder]) => (
                      <label className="field" key={key}>
                        <span>{label} <b>*</b></span>
                        <input
                          value={input.architecture[key as keyof AssessmentInput["architecture"]]}
                          onChange={(event) =>
                            patchInput({
                              architecture: { ...input.architecture, [key]: event.target.value },
                            })
                          }
                          placeholder={placeholder}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="standards-layout">
                  <div className="selection-summary">
                    <div><span>{input.standardIds.length}</span><p>of 3 selected</p></div>
                    <p>One native report is generated for every selected standard.</p>
                  </div>
                  <label className="search-field">
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="Search standards"
                      placeholder="Search all standards or jurisdictions"
                      value={standardSearch}
                      onChange={(event) => setStandardSearch(event.target.value)}
                    />
                  </label>
                  <div className="standards-grid">
                    {visibleStandards.map((standard) => {
                      const recommendation = industry.recommendations.find(
                        (item) => item.standardId === standard.id,
                      );
                      const selected = input.standardIds.includes(standard.id);
                      return (
                        <button
                          className={`standard-card ${selected ? "selected" : ""}`}
                          key={standard.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleStandard(standard.id)}
                        >
                          <span className="check" aria-hidden="true">{selected ? "✓" : ""}</span>
                          <span className="standard-body">
                            <span className="card-topline">
                              <strong>{standard.shortName}</strong>
                              <em className={`kind kind-${standard.kind.toLowerCase()}`}>{standard.kind}</em>
                            </span>
                            <span className="standard-name">{standard.name}</span>
                            <span className="standard-meta">{standard.jurisdiction} · {standard.controls.length} controls</span>
                            {recommendation && <span className="recommendation">Recommended · {recommendation.reason}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="form-stack">
                  <div className="tier-grid">
                    {tierDetails.map((tier) => (
                      <button
                        className={`tier-card ${input.tier === tier.tier ? "selected" : ""}`}
                        key={tier.tier}
                        type="button"
                        aria-pressed={input.tier === tier.tier}
                        onClick={() => patchInput({ tier: tier.tier, credentials: {} })}
                      >
                        <span className="tier-top"><strong>Tier {tier.tier}</strong><em>{tier.coverage}</em></span>
                        <b>{tier.title}</b>
                        <p>{tier.subtitle}</p>
                        <ul>{tier.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                      </button>
                    ))}
                  </div>
                  <div className="coverage-strip">
                    {selectedDefinitions.map((standard) => (
                      <div key={standard.id}>
                        <span>{standard.shortName}</span>
                        <strong>{tierCoverageLabel(standard, input.tier)} controls</strong>
                        <i><b style={{ width: `${(standard.coverage[input.tier] / standard.controls.length) * 100}%` }} /></i>
                      </div>
                    ))}
                  </div>
                  <div className="section-label">
                    <span>Tier {input.tier} access</span>
                    <em>All fields below are required for this tier</em>
                  </div>
                  <div className="field-grid two">
                    {credentialFields[input.tier].map((field) => (
                      <label className="field" key={field.key}>
                        <span>{field.label} <b>*</b></span>
                        <input
                          type={field.type}
                          value={input.credentials[field.key] ?? ""}
                          placeholder={field.placeholder}
                          autoComplete="off"
                          onChange={(event) =>
                            patchInput({
                              credentials: { ...input.credentials, [field.key]: event.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="review-layout">
                  <div className="review-card">
                    <div className="review-title"><span>01</span><div><strong>Assessment scope</strong><p>{input.organization} · {input.systemName}</p></div></div>
                    <dl>
                      <div><dt>Industry</dt><dd>{industry.name}</dd></div>
                      <div><dt>Architecture</dt><dd>{input.architecture.modelName} + {input.architecture.vectorDatabase}</dd></div>
                      <div><dt>Access</dt><dd>Tier {input.tier} · {tierDetails[input.tier - 1].title}</dd></div>
                    </dl>
                  </div>
                  <div className="review-card">
                    <div className="review-title"><span>02</span><div><strong>Exact evaluation scope</strong><p>{input.standardIds.length} standard engines run in parallel</p></div></div>
                    <div className="review-standards">
                      {selectedDefinitions.map((standard) => (
                        <div key={standard.id}><span>{standard.shortName}</span><strong>{tierCoverageLabel(standard, input.tier)}</strong></div>
                      ))}
                      <div className="owasp-row"><span>OWASP LLM Top 10</span><strong>Always included</strong></div>
                    </div>
                  </div>
                  <div className="scope-promise">
                    <span aria-hidden="true">✓</span>
                    <div><strong>Selection governs execution</strong><p>Only {selectedDefinitions.map((item) => item.shortName).join(", ")} will be evaluated. No unrelated framework is loaded.</p></div>
                  </div>
                </div>
              )}

              <div className="panel-footer">
                <button className="button secondary" type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>
                  Back
                </button>
                {step < 3 ? (
                  <button className="button primary" type="button" onClick={nextStep}>Continue <span>→</span></button>
                ) : (
                  <button className="button primary launch" type="button" onClick={runEvaluation} disabled={running}>
                    {running ? "Evaluation running…" : "Launch assessment"} <span>◆</span>
                  </button>
                )}
              </div>
            </>
          )}

          {(running || result) && (
            <div className="results-shell">
              <div className="result-header">
                <div>
                  <p className="eyebrow">{running ? "Assessment in progress" : "Assessment complete"}</p>
                  <h2>{input.systemName}</h2>
                  <p>{input.organization} · Tier {input.tier} · {selectedDefinitions.length} standards</p>
                </div>
                <div className={`completion-mark ${running ? "spinning" : ""}`}>{running ? "◌" : "✓"}</div>
              </div>
              <div className="scope-banner">
                <span>◆</span>
                <p><strong>Selection-locked evaluation</strong> Only {selectedDefinitions.map((item) => item.shortName).join(", ")} were evaluated. OWASP adversarial probes ran alongside them.</p>
                {result && <em>{result.assessmentId}</em>}
              </div>
              <div className="result-tabs" role="tablist" aria-label="Assessment results">
                <button className={activeTab === "progress" ? "active" : ""} onClick={() => setActiveTab("progress")} role="tab">Live progress</button>
                {result?.reports.map((report) => (
                  <button key={report.standardId} className={activeTab === report.standardId ? "active" : ""} onClick={() => setActiveTab(report.standardId)} role="tab">{report.shortName}</button>
                ))}
                {result?.crossInsights && <button className={activeTab === "insights" ? "active" : ""} onClick={() => setActiveTab("insights")} role="tab">Cross insights</button>}
                {result && <button className={activeTab === "download" ? "active" : ""} onClick={() => setActiveTab("download")} role="tab">Export</button>}
              </div>

              {activeTab === "progress" && (
                <div className="progress-panel">
                  <div className="progress-overview">
                    <div><span>{running ? completedControls : totalControls}</span><p>controls processed</p></div>
                    <div><span>{selectedDefinitions.length}</span><p>standard engines</p></div>
                    <div><span>8</span><p>OWASP probes</p></div>
                  </div>
                  <div className="master-progress"><i><b style={{ width: running ? `${Math.min(98, (completedControls / Math.max(1, totalControls)) * 100)}%` : "100%" }} /></i><span>{running ? "Evaluating controls…" : "Evaluation and reporting complete"}</span></div>
                  <div className="event-log" aria-live="polite">
                    {events.slice(-18).reverse().map((item, index) => (
                      <div className="event-row" key={`${item.name}-${index}`}>
                        <span className={`event-dot ${String(item.data.status ?? item.name)}`} />
                        <div><strong>{String(item.data.standard ?? item.name.replaceAll("_", " "))}</strong><p>{String(item.data.control ?? item.data.controlId ?? "Workflow checkpoint complete")}</p></div>
                        <em>{item.data.status ? statusLabel(item.data.status as ControlStatus) : "Done"}</em>
                      </div>
                    ))}
                    {events.length === 0 && <p className="empty-state">Preparing validation and loading selected control packs…</p>}
                  </div>
                  {result && (
                    <div className="pillar-grid">
                      {(Object.entries(result.pillarScores) as Array<[Pillar, number]>).map(([pillar, score]) => (
                        <div key={pillar}><span>{pillarLabels[pillar]}</span><strong>{score}%</strong><i><b style={{ width: `${score}%` }} /></i></div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {result?.reports.map((report) => activeTab === report.standardId && (
                <div className="report-panel" key={report.standardId}>
                  <div className="report-score">
                    <div className="score-ring" style={{ "--score": report.score } as React.CSSProperties}><strong>{report.score}</strong><span>/100</span></div>
                    <div><p className="eyebrow">{report.version}</p><h3>{report.name}</h3><p>{report.summary}</p><span className={`readiness ${report.readiness.toLowerCase().replaceAll(" ", "-")}`}>{report.readiness}</span></div>
                    <button className="button secondary" onClick={() => printReport(report)}>Print / Save PDF</button>
                  </div>
                  <div className="native-structure">
                    <p className="eyebrow">Native report structure</p>
                    <ol>{report.nativeSections.map((section) => <li key={section}>{section}</li>)}</ol>
                  </div>
                  <div className="report-meta">
                    <div><span>Scoring method</span><strong>{report.scoringMethod}</strong></div>
                    <div><span>Pass threshold</span><strong>{report.passThreshold}</strong></div>
                    <div><span>Coverage</span><strong>{report.assessedControls}/{report.totalControls} assessed</strong></div>
                  </div>
                  <div className="control-table-wrap">
                    <table className="control-table">
                      <thead><tr><th>Control</th><th>Pillars</th><th>Status</th><th>Confidence</th><th>Evidence / remediation</th></tr></thead>
                      <tbody>{report.controls.map((control) => (
                        <tr key={control.id}>
                          <td><strong>{control.id}</strong><span>{control.name}</span></td>
                          <td><div className="pillar-tags">{control.pillars.map((pillar) => <em key={pillar}>{pillarLabels[pillar]}</em>)}</div></td>
                          <td><StatusBadge status={control.status} /></td>
                          <td>{Math.round(control.confidence * 100)}%</td>
                          <td><span>{control.evidence}</span>{control.status !== "pass" && control.status !== "not_assessed" && <small>{control.remediation}</small>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              ))}

              {result?.crossInsights && activeTab === "insights" && (
                <div className="insights-panel">
                  <div className="insights-heading"><div><p className="eyebrow">Fix once, satisfy many</p><h3>Cross-standard insights</h3><p>Shared gaps are detected through common governance-pillar tags.</p></div><strong>{result.crossInsights.effortEstimate}</strong></div>
                  <div className="insights-grid">
                    <section><h4>Shared gaps</h4>{result.crossInsights.sharedGaps.length ? result.crossInsights.sharedGaps.map((gap) => (
                      <article key={gap.title}>
                        <span className={`priority ${gap.priority.toLowerCase()}`}>{gap.priority}</span>
                        <div><strong>{gap.title}</strong><p>{gap.standards.join(" + ")}</p><small>Single fix · {gap.singleFix}</small></div>
                      </article>
                    )) : <p className="empty-state">No failed controls share a pillar across selected standards.</p>}</section>
                    <section><h4>Standard-specific gaps</h4>{result.crossInsights.standardSpecificGaps.length ? result.crossInsights.standardSpecificGaps.map((gap) => (
                      <article key={`${gap.standard}-${gap.control}`}><span className="standard-pill">{gap.standard}</span><div><strong>{gap.control}</strong><p>{pillarLabels[gap.pillar]}</p></div></article>
                    )) : <p className="empty-state">No standard-specific failed controls were detected.</p>}</section>
                  </div>
                  <div className="pillar-grid large">
                    {(Object.entries(result.pillarScores) as Array<[Pillar, number]>).map(([pillar, score]) => (
                      <div key={pillar}><span>{pillarLabels[pillar]}</span><strong>{score}%</strong><i><b style={{ width: `${score}%` }} /></i></div>
                    ))}
                  </div>
                </div>
              )}

              {result && activeTab === "download" && (
                <div className="export-panel">
                  <div className="export-intro"><p className="eyebrow">Audit-ready package</p><h3>Export exactly what was assessed.</h3><p>Each document preserves its standard’s native structure, control evidence, confidence, pillar tags, and remediation.</p></div>
                  <div className="export-grid">
                    {result.reports.map((report) => (
                      <button key={report.standardId} onClick={() => printReport(report)}>
                        <span className="file-icon">PDF</span><span><strong>{report.shortName} report</strong><small>{report.assessedControls}/{report.totalControls} controls · {report.score}%</small></span><em>↗</em>
                      </button>
                    ))}
                    <button onClick={() => printReport()}>
                      <span className="file-icon combined">ALL</span><span><strong>Combined report package</strong><small>{result.reports.length} native reports + OWASP appendix</small></span><em>↗</em>
                    </button>
                    <button onClick={downloadJson}>
                      <span className="file-icon evidence">JSON</span><span><strong>Machine-readable evidence</strong><small>Complete results for audit workflows</small></span><em>↓</em>
                    </button>
                  </div>
                </div>
              )}

              {!running && result && (
                <div className="results-footer">
                  <button className="button secondary" onClick={() => { setResult(null); setStep(0); setEvents([]); }}>Start another assessment</button>
                  <span>Generated {new Date(result.generatedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

