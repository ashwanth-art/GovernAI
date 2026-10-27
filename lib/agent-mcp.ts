import rules from "./agent-mcp-rules.json";
import { createPackControl } from "./framework-packs/schema";
import type { Pillar } from "./types";

const source = { authority: "ARQ Governance; MCP project", title: "Authored agent/MCP security evaluations", url: "https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization", status: "current" as const,
  note: "Supporting technical checks, not a certification or equivalence to a regulatory obligation. Native discovery, approved fixture tests and source-declared measurements have different assurance." };
const direct = [
  { id: "mcp-tool-integrity", layer: "application", pillar: "security", name: "MCP approved tool inventory and definition integrity", objective: "Compare a complete bounded tools/list response against operator-approved SHA-256 pins for tool names, descriptions, schemas and annotations. Tool read-only annotations are not trusted authorization." },
  { id: "mcp-metadata", layer: "network", pillar: "security", name: "MCP protected-resource metadata binding", objective: "Compare protected-resource metadata resource and issuer URLs to explicitly configured expected values. Do not follow discovered URLs or claim token-validation effectiveness from metadata." },
  { id: "mcp-authorization-matrix", layer: "application", pillar: "security", name: "Approved sandbox MCP tool authorization cases", objective: "Execute only operator-approved synthetic read fixtures with configured identities. A denied case passes only after a working allow baseline and an explicit HTTP 403; tool errors, 401, redirects and timeouts are inconclusive." },
];
export const agentMcpControls = [...rules.map(rule => ({ ...rule, objective: `Evaluate ${rule.name.toLowerCase()} using fresh connected test measurements for every declared asset. Required fields: ${Object.entries(rule.fields).map(([field, condition]) => `${field}=${condition}`).join("; ")}. A zero tested population or incomplete scope cannot pass.` })), ...direct].map(rule => createPackControl({
  id: `AGENT-${rule.id.toUpperCase()}`, name: rule.name, objective: rule.objective, category: `Seven-pillar security: ${rule.layer}`, tierMinimum: 3, pillars: [rule.pillar as Pillar], testType: "document_verify", evaluationRuleId: `artifact.review-${rule.id}`, evidenceProcedureIds: [`artifact-review-${rule.id}`], severity: ["agent-identity", "agent-audit", "mcp-consent", "mcp-metadata", "mcp-tool-integrity"].includes(rule.id) ? "high" : "critical", section: rule.id, mappingType: "governai_evidence_mapping", remediationId: rule.id,
  remediation: "fix" in rule && typeof rule.fix === "string" ? rule.fix : "Correct the observed MCP boundary in the connected scope, then rerun the same approved fixture or discovery check.",
}, source));
