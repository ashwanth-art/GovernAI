export type Pillar =
  | "trust"
  | "security"
  | "governance"
  | "compliance"
  | "data_protection";

export type ControlStatus =
  | "pass"
  | "fail"
  | "partial"
  | "not_assessed"
  | "not_applicable";

export type AccessTier = 1 | 2 | 3;

export type StandardKind = "Mandatory" | "Certifiable" | "Methodological";

export interface OfficialReference {
  authority: string;
  title: string;
  url: string;
  status: "current" | "under_revision" | "superseded" | "licensed_preview";
  note: string;
}

export interface SourceCitation {
  authority: string;
  document: string;
  section: string;
  url: string;
  mappingType: "official_requirement" | "official_guidance" | "governai_evidence_mapping";
  note: string;
}

export type EvidenceSourceType =
  | "target_service"
  | "chatbot_probe"
  | "target_trace"
  | "target_adapter"
  | "provided_url"
  | "artifact_manifest"
  | "provider_api";

export interface Control {
  id: string;
  name: string;
  objective?: string;
  category: string;
  tierMinimum: AccessTier;
  pillars: Pillar[];
  testType: "adversarial_probe" | "config_check" | "document_verify";
  applicability?: string[];
  evidenceProcedureIds?: string[];
  evaluationRuleId?: string;
  severity?: "critical" | "high" | "medium" | "low";
  remediationId?: string;
  remediation: string;
  sourceCitation?: SourceCitation;
}

export interface StandardDefinition {
  id: string;
  shortName: string;
  name: string;
  version: string;
  kind: StandardKind;
  jurisdiction: string;
  description: string;
  reportFormat: string;
  scoringMethod: string;
  passThreshold: string;
  officialReference: OfficialReference;
  controls: Control[];
  coverage: Record<AccessTier, number>;
  pack?: {
    release: string;
    status: "draft" | "review" | "approved" | "superseded";
    assuranceLevel: "screening" | "readiness" | "audit_supported";
    sourceVersion: string;
    publishedAt: string;
    contentHash: string;
    note: string;
  };
}

export interface IndustryDefinition {
  id: string;
  name: string;
  description: string;
  recommendations: Array<{
    standardId: string;
    reason: string;
  }>;
}

export interface AssessmentInput {
  organization: string;
  systemName: string;
  industryId: string;
  standardIds: string[];
  tier: AccessTier;
  credentials: Record<string, string>;
  architecture: {
    modelProvider: string;
    modelName: string;
    vectorDatabase: string;
    embeddingModel: string;
  };
}

export interface ControlResult extends Control {
  status: ControlStatus;
  applicabilityStatus: "applicable" | "not_applicable" | "unknown";
  applicabilityReason: string;
  score: number;
  confidence: number;
  evidence: string;
}

export interface StandardReport {
  standardId: string;
  shortName: string;
  name: string;
  version: string;
  score: number;
  readiness: string;
  scoringMethod: string;
  passThreshold: string;
  officialReference: OfficialReference;
  nativeSections: string[];
  summary: string;
  assessedControls: number;
  totalControls: number;
  applicableControls?: number;
  notApplicableControls?: number;
  unknownApplicabilityControls?: number;
  coveragePercent?: number;
  assuranceLevel?: "screening" | "readiness" | "audit_supported";
  packRelease?: string;
  controls: ControlResult[];
}

export interface AssessmentResult {
  assessmentId: string;
  generatedAt: string;
  liveEvidence: {
    mode: "live";
    target: string;
    chatEndpoint: string;
    startedAt: string;
    durationMs: number;
    traces: Array<{
      requestId: string;
      probeId: string;
      status: "success" | "blocked" | "error" | "running";
      startedAt: string;
      completedAt?: string;
      durationMs?: number;
      stages: Array<{
        name: string;
        status: "pass" | "partial" | "blocked" | "error";
        summary: string;
        durationMs: number;
        metrics: Record<string, string | number | boolean>;
      }>;
    }>;
      probes: Array<{
      id: string;
      label: string;
      status: ControlStatus;
      summary: string;
      latencyMs?: number;
      httpStatus?: number;
      requestId?: string;
      sourceCount?: number;
      bestSourceScore?: number;
      sourceType: EvidenceSourceType;
      endpoint: string;
      method: "GET" | "POST" | "HEAD";
      validationMethod?: string;
      officialPageFetched?: false;
    }>;
      execution: {
      runner: string;
      controlCatalog: string;
      officialStandardsPagesFetched: false;
      tier2RequestsParallel: boolean;
      infrastructureProvider?: string;
      monitoringProvider?: string;
      collectors?: Array<{
        id: string;
        provider: string;
        status: ControlStatus;
        summary: string;
      }>;
      summary: {
        startedAt: string;
        completedAt: string;
        totalSteps: number;
        completedSteps: number;
        warningSteps: number;
        failedSteps: number;
        durationMs: number;
      };
    };
  };
  scope: {
    organization: string;
    systemName: string;
    industry: string;
    tier: AccessTier;
    selectedStandards: string[];
    architecture: AssessmentInput["architecture"];
  };
  reports: StandardReport[];
  owasp: ControlResult[];
  pillarScores: Record<Pillar, number>;
  /** Derived engineering-register view. Adds no evidence; see lib/analysis.ts. */
  analysis: AssessmentAnalysis;
  crossInsights: null | {
    sharedGaps: Array<{
      title: string;
      standards: string[];
      pillars: Pillar[];
      priority: "Critical" | "High" | "Medium";
      singleFix: string;
    }>;
    standardSpecificGaps: Array<{
      standard: string;
      control: string;
      pillar: Pillar;
    }>;
    effortEstimate: string;
  };
}

/* ============================================================================
   Engineering-register analysis layer
   ----------------------------------------------------------------------------
   Everything below is DERIVED from the fields above. No new evidence is
   invented here: a check is a named view of the rule the engine already
   applied, a finding is a named view of a control that already failed, and a
   posture number is an aggregate of statuses the engine already produced.
   ========================================================================== */

/**
 * Retained as a single-member union rather than deleted.
 *
 * The field it types is serialised into every stored result, so a result written
 * before the audience toggle was removed still parses. Narrowing it to one member
 * is what makes the removal enforceable: any code that tries to reintroduce a
 * second register fails to compile.
 */
export type TermRegister = "engineering";

export type CheckMethod =
  | "live_probe"
  | "adapter_read"
  | "provider_api"
  | "named_artifact"
  | "not_supported";

export type Severity = "critical" | "high" | "medium" | "low";

export interface RuleSpec {
  id: string;
  statement: string;
  passWhen: string;
  partialWhen: string;
  failWhen: string;
  thresholds: Array<{ key: string; value: string }>;
}

/**
 * Where a rule came from, which is not the same question as whether it passed.
 *
 * `direct` — the rule was written against the control it judges.
 * `proxy`  — no rule exists for that control, so a pillar-level probe stands in. The verdict is
 *            about the pillar's behaviour, not the control's text, and it must be labelled as
 *            such wherever the verdict is shown. The governance proxy cannot return `pass` at
 *            all, by design.
 *
 * Kept as a declared field rather than inferred from an id prefix so the distinction survives
 * every layer it passes through: analysis, events, reports, exports.
 */
export type RuleProvenance = "direct" | "proxy";

export interface CheckDefinition {
  id: string;
  ruleId: string;
  title: string;
  intent: string;
  pillar: Pillar;
  domainId: string;
  method: CheckMethod;
  tierMinimum: AccessTier;
  provenance: RuleProvenance;
  probeId?: string;
  request?: { method: "GET" | "POST" | "HEAD"; endpoint: string; note: string };
  rule: RuleSpec;
}

export interface CheckExecution extends CheckDefinition {
  status: ControlStatus;
  ran: boolean;
  notRunReason: string;
  closedBy: string;
  evidence: string;
  confidence: number;
  latencyMs?: number;
  httpStatus?: number;
  requestId?: string;
  observations: Array<{ key: string; value: string }>;
  controls: Array<{ standardId: string; shortName: string; controlId: string; controlName: string; section?: string }>;
  severity: Severity;
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  impact: string;
  severity: Severity;
  pillar: Pillar;
  domainId: string;
  owner: string;
  detectedBy: string[];
  breaches: Array<{ standardId: string; shortName: string; controlId: string; controlName: string; section?: string }>;
  blastRadius: { controls: number; standards: number; pillars: Pillar[] };
  remediationId?: string;
  closesWhen: string;
}

export interface CoverageGap {
  controlId: string;
  controlName: string;
  standardId: string;
  shortName: string;
  pillar: Pillar;
  tierMinimum: AccessTier;
  reason: string;
  closedBy: string;
}

export interface RemediationPlaybook {
  id: string;
  title: string;
  owner: string;
  effortHours: [number, number];
  steps: Array<{ order: number; action: string; where: string }>;
  verification: { checkIds: string[]; statement: string };
  closes: Array<{ standardId: string; shortName: string; controlId: string }>;
  closesCount: number;
  standardsCount: number;
  findingIds: string[];
  severity: Severity;
  rank: number;
}

export interface PostureNumbers {
  applicable: number;
  assessed: number;
  notAssessed: number;
  notApplicable: number;
  coveragePercent: number;
  healthPercent: number;
  exposureIndex: number;
  severityCounts: Record<Severity, number>;
  openFindings: number;
  verdict: string;
  verdictReason: string;
}

export interface DomainPosture {
  id: string;
  label: string;
  question: string;
  checksRan: number;
  checksTotal: number;
  status: ControlStatus;
  findings: number;
}

export interface PillarPosture {
  pillar: Pillar;
  key: string;
  label: string;
  question: string;
  hue: string;
  applicable: number;
  assessed: number;
  coveragePercent: number;
  healthPercent: number;
  checksRan: number;
  checksTotal: number;
  provenance: ProvenanceSplit;
  severityCounts: Record<Severity, number>;
  domains: DomainPosture[];
}

export interface EvidenceRecordView {
  id: string;
  label: string;
  sourceType: EvidenceSourceType;
  method: "GET" | "POST" | "HEAD";
  endpoint: string;
  status: ControlStatus;
  httpStatus?: number;
  latencyMs?: number;
  requestId?: string;
  collectedAt: string;
  validityDays: number;
  freshness: "fresh" | "stale" | "expired";
  digest: string;
  usedByChecks: number;
  summary: string;
}

export interface MonitorPlanEntry {
  id: string;
  label: string;
  pillar: Pillar;
  cadence: string;
  cadenceMinutes: number;
  method: CheckMethod;
  checkIds: string[];
  requestsPerMonth: number;
  /**
   * What arming this monitor costs, stated before anyone arms it. Not a blocker any
   * more — monitors do run — but the consequence still belongs next to the switch.
   */
  armingCost: string;
}

/**
 * How the assessed verdicts were reached, at whatever altitude it is asked about.
 *
 * Deliberately a separate axis from coverage, health and exposure: a pack can be fully covered
 * and fully healthy while every verdict came from a pillar proxy. Blending the two would hide
 * exactly the thing this number exists to expose. `assessed` is the denominator — a control
 * with no verdict has no provenance to report, so it is counted nowhere here.
 */
export interface ProvenanceSplit {
  direct: number;
  proxy: number;
  assessed: number;
}

export interface FrameworkMatrixRow {
  standardId: string;
  shortName: string;
  readiness: string;
  coveragePercent: number;
  healthPercent: number;
  applicable: number;
  assessed: number;
  excluded: number;
  unknown: number;
  packRelease?: string;
  provenance: ProvenanceSplit;
  cells: Array<{ pillar: Pillar; applicable: number; assessed: number; coveragePercent: number }>;
}

export interface AssessmentAnalysis {
  register: TermRegister;
  posture: PostureNumbers;
  pillars: PillarPosture[];
  checks: CheckExecution[];
  findings: Finding[];
  gaps: CoverageGap[];
  playbooks: RemediationPlaybook[];
  matrix: FrameworkMatrixRow[];
  /** The run-wide split, so the summary screen can state it in one line. */
  provenance: ProvenanceSplit;
  evidence: EvidenceRecordView[];
  monitorPlan: MonitorPlanEntry[];
  notes: string[];
}

export interface CheckPlan {
  tier: AccessTier;
  totalChecks: number;
  runnableChecks: number;
  blockedChecks: number;
  applicableControls: number;
  reachableControls: number;
  estimatedSeconds: number;
  boundedRequests: number;
  forecast: Array<{
    tier: AccessTier;
    label: string;
    byPillar: Array<{ pillar: Pillar; label: string; reachable: number; applicable: number; percent: number }>;
    reachable: number;
    applicable: number;
    percent: number;
  }>;
  checks: Array<CheckDefinition & { willRun: boolean; notRunReason: string; controlCount: number }>;
  blindSpots: Array<{ reason: string; controls: number; closedBy: string }>;
  safety: string[];
}
