import { primaryPillar } from "./pillars";
import { supportingTechnicalChecks, assessmentMethod } from "./deployment-evaluation";
import type { AccessTier, AssessmentResult, Control, ControlStatus, ControlResult } from "./types";

export const applicationLayers = [
  { id: "identity", name: "Users & identities", examples: "IAM · MFA · privileged access · sessions", sources: "Identity provider, IAM/PAM, HR reconciliation and approved test accounts" },
  { id: "device", name: "Devices & runtime", examples: "Endpoints · EDR · hardening · patches", sources: "Endpoint management, EDR, vulnerability and runtime inventory" },
  { id: "application", name: "Applications & AI", examples: "Frontend · APIs · AI tools · software supply chain", sources: "Browser observations, application tests, CI and AI evaluation records" },
  { id: "data", name: "Data & cryptography", examples: "Data access · encryption · retention · restoration", sources: "Database, DLP, key management, privacy and restore-test evidence" },
  { id: "network", name: "Networks & edge", examples: "DNS · TLS · segmentation · WAF · egress", sources: "Public edge observations, cloud/network configuration and connectivity tests" },
  { id: "automation", name: "Automation & response", examples: "Approvals · playbooks · exceptions · recovery", sources: "Change approvals, SOAR, GRC and incident/recovery exercise records" },
  { id: "visibility", name: "Visibility & analytics", examples: "Monitoring · audit logs · detection · correlation", sources: "CloudWatch, CloudTrail, SIEM/SOC and detection-test records" },
] as const;
export type ApplicationLayerId = typeof applicationLayers[number]["id"];
export type MapControl = Control & { status?: ControlStatus; evidence?: string; method?: string; supportingChecks?: ControlResult[] };
export interface MapStandard { id: string; shortName: string; controls: MapControl[] }

/** Technical grouping, not an additional official/regulatory crosswalk. A
 * control can relate to multiple layers; totals always count it only once.
 */
export function layersForControl(control: Control): { layers: ApplicationLayerId[]; basis: string } {
  const authored = control.category.match(/^Seven-pillar security: (identity|device|application|data|network|automation|visibility)$/)?.[1];
  if (authored) return { layers: [authored as ApplicationLayerId], basis: "Authored layer evaluation" };
  const rule = control.evaluationRuleId ?? "";
  if (/^artifact\.review-/.test(rule)) {
    const key = rule.slice("artifact.review-".length);
    const layer: ApplicationLayerId = /^(auth-|identity-|entra-|aws-iam-|aws-root-|aws-access-analyzer)/.test(key) ? "identity"
      : /^(dns-|tls-|aws-admin-)/.test(key) ? "network"
        : /^(azure-storage-|azure-vault-|aws-storage-)/.test(key) ? "data"
          : /^(azure-diagnostics|aws-alarm-|aws-log-|aws-trail-)/.test(key) ? "visibility" : "application";
    return { layers: [layer], basis: "Authored deployment evaluation" };
  }
  const text = `${rule} ${control.category} ${control.name}`;
  const layers = new Set<ApplicationLayerId>();
  if (/privileged|\biam\b|\bmfa\b|identit|entitlement|credential|tenant|authoriz|authenticat|segregation|maker.checker/i.test(text)) layers.add("identity");
  if (/device|endpoint detection|\bedr\b|patch|vulnerab|host.harden|physical|workstation/i.test(text)) layers.add("device");
  if (/\bdns\b|\btls\b|network|\bwaf\b|ddos|segment|transport|egress|ingress/i.test(text)) layers.add("network");
  if (/data|privacy|retention|encrypt|cryptograph|key.management|redact|pii|phi|consent|erasure/i.test(text)) layers.add("data");
  if (/monitor|audit.log|audit.trail|security.log|detection|alert|forensic|telemetry/i.test(text)) layers.add("visibility");
  if (/change.control|approval|playbook|exception|incident.response|recovery|continuity/i.test(text)) layers.add("automation");
  if (/probe\.|model|\bai\b|software|application|prompt|retriev|corpus|supply.chain|output|tool.permission/i.test(text)) layers.add("application");
  if (!layers.size) layers.add(({ trust: "application", security: "application", data_protection: "data", governance: "automation", compliance: "visibility" } as const)[primaryPillar(control)]);
  return { layers: [...layers], basis: "Related objective grouping; see the control's own source mapping" };
}

export function buildApplicationMap(standards: MapStandard[], tier: AccessTier) {
  const controls = standards.flatMap(standard => standard.controls.map(control => ({ ...control, standardId: standard.id, shortName: standard.shortName,
    ...layersForControl(control), state: control.status ?? (control.tierMinimum <= tier ? "planned" : "needs_deeper_tier") })));
  return { total: controls.length, evaluated: controls.filter(control => ["pass", "fail"].includes(control.state)).length,
    layers: applicationLayers.map(layer => {
      const rows = controls.filter(control => control.layers.includes(layer.id));
      return { ...layer, controls: rows, passed: rows.filter(control => control.state === "pass").length, failed: rows.filter(control => control.state === "fail").length,
        pending: rows.filter(control => !["pass", "fail"].includes(control.state)).length };
    }),
  };
}

export function mapStandardsFromResult(result: AssessmentResult): MapStandard[] {
  const technical = technicalChecksFromResult(result);
  return result.reports.filter(report => report.standardId !== "deployment_review").map(report => ({ id: report.standardId, shortName: report.shortName,
    controls: report.controls.map(control => ({ ...control, method: assessmentMethod(control), supportingChecks: supportingTechnicalChecks(control, technical) })) }));
}

/** Old saved reports remain readable; new runs need no separate pack. */
export function technicalChecksFromResult(result: AssessmentResult): ControlResult[] {
  return result.review?.technicalAssessments ?? result.reports.find(report => report.standardId === "deployment_review")?.controls ?? [];
}
