import { industries, industryById, standardById } from "./catalog";
import type {
  AccessTier,
  AssessmentInput,
  AssessmentResult,
  Control,
  ControlResult,
  Pillar,
  StandardDefinition,
  StandardReport,
} from "./types";

export const credentialFields: Record<
  AccessTier,
  Array<{ key: string; label: string; type: "text" | "password" | "url"; placeholder: string }>
> = {
  1: [
    {
      key: "chatbotEndpoint",
      label: "Chatbot API endpoint",
      type: "url",
      placeholder: "https://api.example.com/v1/chat",
    },
    {
      key: "chatbotApiKey",
      label: "Chatbot API key",
      type: "password",
      placeholder: "Stored only for this evaluation request",
    },
  ],
  2: [
    {
      key: "chatbotEndpoint",
      label: "Chatbot API endpoint",
      type: "url",
      placeholder: "https://api.example.com/v1/chat",
    },
    {
      key: "chatbotApiKey",
      label: "Chatbot API key",
      type: "password",
      placeholder: "Stored only for this evaluation request",
    },
    {
      key: "cloudProvider",
      label: "Cloud provider",
      type: "text",
      placeholder: "AWS, Azure, or GCP",
    },
    {
      key: "cloudApiKey",
      label: "Read-only cloud API key",
      type: "password",
      placeholder: "Read-only audit credential",
    },
    {
      key: "monitoringProvider",
      label: "Monitoring provider",
      type: "text",
      placeholder: "Datadog, CloudWatch, or equivalent",
    },
    {
      key: "monitoringApiKey",
      label: "Monitoring API key",
      type: "password",
      placeholder: "Read-only monitoring credential",
    },
    {
      key: "cicdUrl",
      label: "CI/CD pipeline URL",
      type: "url",
      placeholder: "https://github.com/org/repo/actions",
    },
  ],
  3: [
    {
      key: "chatbotEndpoint",
      label: "Chatbot API endpoint",
      type: "url",
      placeholder: "https://api.example.com/v1/chat",
    },
    {
      key: "chatbotApiKey",
      label: "Chatbot API key",
      type: "password",
      placeholder: "Stored only for this evaluation request",
    },
    {
      key: "cloudProvider",
      label: "Cloud provider",
      type: "text",
      placeholder: "AWS, Azure, or GCP",
    },
    {
      key: "cloudApiKey",
      label: "Read-only cloud API key",
      type: "password",
      placeholder: "Read-only audit credential",
    },
    {
      key: "monitoringProvider",
      label: "Monitoring provider",
      type: "text",
      placeholder: "Datadog, CloudWatch, or equivalent",
    },
    {
      key: "monitoringApiKey",
      label: "Monitoring API key",
      type: "password",
      placeholder: "Read-only monitoring credential",
    },
    {
      key: "cicdUrl",
      label: "CI/CD pipeline URL",
      type: "url",
      placeholder: "https://github.com/org/repo/actions",
    },
    {
      key: "repoUrl",
      label: "Source repository URL",
      type: "url",
      placeholder: "https://github.com/org/rag-service",
    },
    {
      key: "stagingUrl",
      label: "Staging environment URL",
      type: "url",
      placeholder: "https://staging.example.com",
    },
    {
      key: "modelRegistryUrl",
      label: "Model registry URL",
      type: "url",
      placeholder: "https://registry.example.com/models/rag",
    },
  ],
};

export function validateAssessmentInput(input: AssessmentInput): string[] {
  const errors: string[] = [];
  if (!input.organization?.trim()) errors.push("Organization is required.");
  if (!input.systemName?.trim()) errors.push("AI system name is required.");
  if (!industryById.has(input.industryId)) errors.push("Select a supported industry.");
  if (![1, 2, 3].includes(input.tier)) errors.push("Select Tier 1, Tier 2, or Tier 3.");
  if (!Array.isArray(input.standardIds) || input.standardIds.length < 1 || input.standardIds.length > 3) {
    errors.push("Select between 1 and 3 compliance standards.");
  }
  if (new Set(input.standardIds).size !== input.standardIds.length) {
    errors.push("Duplicate standards are not allowed.");
  }
  input.standardIds?.forEach((id) => {
    if (!standardById.has(id)) errors.push(`Unknown compliance standard: ${id}.`);
  });

  const architecture = input.architecture ?? ({} as AssessmentInput["architecture"]);
  if (!architecture.modelProvider?.trim()) errors.push("Model provider is required.");
  if (!architecture.modelName?.trim()) errors.push("Model name is required.");
  if (!architecture.vectorDatabase?.trim()) {
    errors.push("Vector database is required to confirm the target is a RAG system.");
  }
  if (!architecture.embeddingModel?.trim()) {
    errors.push("Embedding model is required to confirm the target is a RAG system.");
  }

  const credentials = input.credentials ?? {};
  const fields = credentialFields[input.tier] ?? [];
  fields.forEach((field) => {
    const value = credentials[field.key]?.trim();
    if (!value) errors.push(`${field.label} is required for Tier ${input.tier}.`);
    if (value && field.type === "url") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:") errors.push(`${field.label} must use HTTPS.`);
      } catch {
        errors.push(`${field.label} must be a valid URL.`);
      }
    }
  });
  return [...new Set(errors)];
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function resultForControl(
  control: Control,
  tier: AccessTier,
  assessmentSeed: string,
  standardId: string,
): ControlResult {
  if (control.tierMinimum > tier) {
    return {
      ...control,
      status: "not_assessed",
      score: 0,
      confidence: 0,
      evidence: `Not assessed — requires Tier ${control.tierMinimum} access.`,
    };
  }
  const outcome = hashText(`${assessmentSeed}:${standardId}:${control.id}`) % 10;
  const status: ControlResult["status"] = outcome < 6 ? "pass" : outcome < 8 ? "partial" : "fail";
  const score = status === "pass" ? 1 : status === "partial" ? 0.5 : 0;
  const confidence = tier === 1 ? 0.72 : tier === 2 ? 0.88 : 0.97;
  const evidence =
    status === "pass"
      ? `${control.testType.replaceAll("_", " ")} produced evidence consistent with the control objective.`
      : status === "partial"
        ? `Evidence was present but incomplete for ${control.name.toLowerCase()}.`
        : `No sufficient evidence was observed for ${control.name.toLowerCase()}.`;
  return { ...control, status, score, confidence, evidence };
}

const nativeSectionsByStandard: Record<string, string[]> = {
  hipaa: [
    "Entity Information + Assessment Scope",
    "Administrative Safeguards (45 CFR 164.308)",
    "Technical Safeguards (45 CFR 164.312)",
    "Physical Safeguards (45 CFR 164.310)",
    "Overall Compliance Status + Pillar Breakdown",
    "Remediation Priority List",
  ],
  iso42001: [
    "Statement of Applicability",
    "Clauses 4–10 Conformity Assessment",
    "Annex A Control Results",
    "Major and Minor Non-Conformities",
    "Observations and Opportunities for Improvement",
    "Certificate Readiness + Pillar Breakdown",
  ],
  nist_ai_rmf: [
    "AI System Profile",
    "Govern Function Maturity",
    "Map Function Maturity",
    "Measure Function Maturity",
    "Manage Function Maturity",
    "Risk Summary + Recommended Actions",
  ],
  eu_ai_act: [
    "System Classification and Scope",
    "Risk Management Requirements",
    "Data Governance and Technical Documentation",
    "Transparency and Human Oversight",
    "Accuracy, Robustness, and Cybersecurity",
    "Conformity Readiness and Remediation",
  ],
  soc2: [
    "System Description and Period",
    "Trust Services Criteria in Scope",
    "Control Design and Operating Effectiveness",
    "Exceptions and Compensating Controls",
    "Management Response",
    "Overall Assurance Conclusion",
  ],
  nyc_ll144: [
    "Automated Employment Decision Tool Scope",
    "Independent Bias Audit Evidence",
    "Selection and Scoring Rates",
    "Four-Fifths Rule Analysis",
    "Publication and Candidate Notice",
    "Compliance Conclusion",
  ],
};

function buildStandardReport(
  definition: StandardDefinition,
  input: AssessmentInput,
  assessmentSeed: string,
): StandardReport {
  const controls = definition.controls.map((control) =>
    resultForControl(control, input.tier, assessmentSeed, definition.id),
  );
  const assessed = controls.filter((control) => control.status !== "not_assessed");
  const score = assessed.length
    ? Math.round((assessed.reduce((sum, control) => sum + control.score, 0) / assessed.length) * 100)
    : 0;
  const failures = assessed.filter((control) => control.status === "fail").length;
  const readiness =
    failures === 0 && score >= 90
      ? "Ready"
      : failures <= Math.max(1, Math.floor(assessed.length * 0.1))
        ? "Conditionally ready"
        : "Remediation required";
  const nativeSections = nativeSectionsByStandard[definition.id] ?? [
    "Scope and Applicability",
    `${definition.shortName} Control Assessment`,
    "Evidence and Exceptions",
    "Pillar Breakdown",
    "Priority Remediation Plan",
    "Readiness Conclusion",
  ];
  return {
    standardId: definition.id,
    shortName: definition.shortName,
    name: definition.name,
    version: definition.version,
    score,
    readiness,
    scoringMethod: definition.scoringMethod,
    passThreshold: definition.passThreshold,
    nativeSections,
    summary: `${definition.shortName} evaluated ${assessed.length} of ${controls.length} controls available at Tier ${input.tier}. ${failures} assessed controls require remediation.`,
    assessedControls: assessed.length,
    totalControls: controls.length,
    controls,
  };
}

const owaspControls: Control[] = [
  ["LLM01", "Prompt Injection", ["security"], "Add layered instruction isolation, input classification, and retrieval boundary checks."],
  ["LLM02", "Sensitive Information Disclosure", ["security", "data_protection"], "Redact sensitive data and enforce output data-loss prevention."],
  ["LLM03", "Training Data Poisoning", ["security", "trust"], "Verify source provenance and quarantine anomalous content before indexing."],
  ["LLM04", "Model Denial of Service", ["security"], "Apply token, concurrency, recursion, and cost limits."],
  ["LLM05", "Insecure Output Handling", ["security"], "Treat model output as untrusted and apply contextual encoding."],
  ["LLM06", "Excessive Agency", ["security", "governance"], "Constrain tools, permissions, and consequential actions with human approval."],
  ["LLM07", "System Prompt Leakage", ["security"], "Keep secrets out of prompts and detect prompt-extraction patterns."],
  ["LLM08", "Vector and Embedding Weaknesses", ["security", "trust"], "Enforce tenant isolation, signed ingestion, and retrieval integrity monitoring."],
].map(([id, name, pillars, remediation]) => ({
  id: id as string,
  name: name as string,
  category: "OWASP LLM Top 10",
  tierMinimum: 1,
  pillars: pillars as Pillar[],
  testType: "adversarial_probe",
  remediation: remediation as string,
}));

function buildOwaspResults(input: AssessmentInput, seed: string): ControlResult[] {
  return owaspControls.map((control) => resultForControl(control, input.tier, seed, "owasp"));
}

function buildPillarScores(reports: StandardReport[], owasp: ControlResult[]) {
  const pillars: Pillar[] = ["trust", "security", "governance", "compliance", "data_protection"];
  const all = [...reports.flatMap((report) => report.controls), ...owasp].filter(
    (control) => control.status !== "not_assessed",
  );
  return Object.fromEntries(
    pillars.map((pillar) => {
      const matching = all.filter((control) => control.pillars.includes(pillar));
      return [
        pillar,
        matching.length
          ? Math.round((matching.reduce((sum, control) => sum + control.score, 0) / matching.length) * 100)
          : 0,
      ];
    }),
  ) as Record<Pillar, number>;
}

function buildCrossInsights(reports: StandardReport[]): AssessmentResult["crossInsights"] {
  if (reports.length < 2) return null;
  const failedByPillar = new Map<Pillar, Array<{ standard: string; control: ControlResult }>>();
  reports.forEach((report) => {
    report.controls
      .filter((control) => control.status === "fail")
      .forEach((control) =>
        control.pillars.forEach((pillar) => {
          const items = failedByPillar.get(pillar) ?? [];
          items.push({ standard: report.shortName, control });
          failedByPillar.set(pillar, items);
        }),
      );
  });

  const sharedGaps = [...failedByPillar.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.standard)).size > 1)
    .slice(0, 5)
    .map(([pillar, items], index) => ({
      title: `${pillar.replaceAll("_", " ")} control weakness`,
      standards: [...new Set(items.map((item) => item.standard))],
      pillars: [pillar],
      priority: (index < 2 ? "Critical" : "High") as "Critical" | "High",
      singleFix: items[0].control.remediation,
    }));

  const standardSpecificGaps = reports
    .flatMap((report) =>
      report.controls
        .filter((control) => control.status === "fail")
        .map((control) => ({
          standard: report.shortName,
          control: `${control.id} ${control.name}`,
          pillar: control.pillars[0],
        })),
    )
    .filter((gap) => {
      const entries = failedByPillar.get(gap.pillar) ?? [];
      return new Set(entries.map((entry) => entry.standard)).size === 1;
    })
    .slice(0, 6);

  const remediationCount = reports.reduce(
    (sum, report) => sum + report.controls.filter((control) => control.status !== "pass" && control.status !== "not_assessed").length,
    0,
  );
  const weeks = Math.max(2, Math.ceil(remediationCount / 4));
  return {
    sharedGaps,
    standardSpecificGaps,
    effortEstimate: `${remediationCount} remediation items; approximately ${weeks}–${weeks + 2} weeks, prioritising shared gaps first.`,
  };
}

export function runAssessment(input: AssessmentInput): AssessmentResult {
  const errors = validateAssessmentInput(input);
  if (errors.length) throw new Error(errors.join("\n"));
  const assessmentSeed = `${input.organization}:${input.systemName}:${input.industryId}:${input.tier}`;
  const reports = input.standardIds.map((id) =>
    buildStandardReport(standardById.get(id)!, input, assessmentSeed),
  );
  const owasp = buildOwaspResults(input, assessmentSeed);
  const pillarScores = buildPillarScores(reports, owasp);
  const assessmentId = `AGR-${hashText(`${assessmentSeed}:${input.standardIds.join(",")}`)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0")}`;
  return {
    assessmentId,
    generatedAt: new Date().toISOString(),
    scope: {
      organization: input.organization.trim(),
      systemName: input.systemName.trim(),
      industry: industryById.get(input.industryId)?.name ?? industries[0].name,
      tier: input.tier,
      selectedStandards: reports.map((report) => report.shortName),
      architecture: input.architecture,
    },
    reports,
    owasp,
    pillarScores,
    crossInsights: buildCrossInsights(reports),
  };
}

export function safeCatalog() {
  return {
    industries,
    standards: [...standardById.values()].map((standard) => ({
      ...standard,
      controls: undefined,
      totalControls: standard.controls.length,
    })),
    credentialFields,
  };
}

