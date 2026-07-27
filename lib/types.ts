export type Pillar =
  | "trust"
  | "security"
  | "governance"
  | "compliance"
  | "data_protection";

export type ControlStatus = "pass" | "fail" | "partial" | "not_assessed";

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
  | "target_adapter"
  | "provided_url";

export interface Control {
  id: string;
  name: string;
  category: string;
  tierMinimum: AccessTier;
  pillars: Pillar[];
  testType: "adversarial_probe" | "config_check" | "document_verify";
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
