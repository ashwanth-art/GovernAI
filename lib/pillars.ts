import type { Control, Pillar } from "./types";

/**
 * The pillar/domain registry.
 *
 * Pillar keys are the ones already in the type system and in every pack — they
 * are never renamed. `label` is the heading a reader sees; the key remains the
 * identifier everywhere it is an identifier.
 *
 * Domains are a presentation grouping inside a pillar. A control is assigned to
 * a domain by matching its category and name; the fallback domain is always
 * present so no control is ever silently dropped from a pillar page.
 */
export interface DomainDefinition {
  id: string;
  label: string;
  question: string;
  match: RegExp | null;
}

export interface PillarDefinition {
  pillar: Pillar;
  /** The heading. A heading is not an identifier, so it is written to be read. */
  label: string;
  /** Compact form for radar spokes and matrix headers, where the full name will not fit. */
  short: string;
  question: string;
  hue: string;
  domains: DomainDefinition[];
}

export const pillarRegistry: PillarDefinition[] = [
  {
    pillar: "trust",
    label: "Trust & transparency",
    short: "Trust",
    question: "Does it tell the truth, cite its sources, and let a human step in?",
    hue: "#0e8b86",
    domains: [
      {
        id: "trust.grounding",
        label: "Grounding & citation fidelity",
        question: "Is every answer supported by retrieved evidence?",
        match: /ground|citation|retriev|accuracy|hallucin|misinform|explain/i,
      },
      {
        id: "trust.scope",
        label: "Scope discipline",
        question: "Does it refuse questions outside the approved corpus?",
        match: /scope|out-of-scope|boundar|refus/i,
      },
      {
        id: "trust.disclosure",
        label: "AI disclosure & transparency",
        question: "Do users know they are talking to an AI system?",
        match: /disclos|transparen|instructions for use|notice|inform/i,
      },
      {
        id: "trust.oversight",
        label: "Human oversight",
        question: "Can a person intervene, override, or stop it?",
        match: /oversight|human|shutdown|intervene|challenge|feedback/i,
      },
      {
        id: "trust.evaluation",
        label: "Evaluation & measurement",
        question: "Is its behaviour measured on a repeatable basis?",
        match: /measur|evaluat|bias|test|benchmark|reproduc/i,
      },
      { id: "trust.general", label: "Other trust controls", question: "Everything else in this pillar.", match: null },
    ],
  },
  {
    pillar: "security",
    label: "Security",
    short: "Security",
    question: "Can someone attack it or talk it out of its rules?",
    hue: "#4655a8",
    domains: [
      {
        id: "security.injection",
        label: "Prompt-injection containment",
        question: "Can an instruction in the input override the system's rules?",
        match: /injection|jailbreak|prompt|adversar/i,
      },
      {
        id: "security.isolation",
        label: "Access control & isolation",
        question: "Can one tenant or user reach another's data?",
        match: /access|isolation|tenant|authoriz|authent|unique|workforce|sanction/i,
      },
      {
        id: "security.output",
        label: "Output handling",
        question: "Is model output treated as untrusted before it is rendered or used?",
        match: /output|markup|render|handling|agent/i,
      },
      {
        id: "security.supplychain",
        label: "Supply chain & dependencies",
        question: "Do we know what models, corpora and packages it depends on?",
        match: /supply|dependen|corpus|third.?party|vector|model registry/i,
      },
      {
        id: "security.resilience",
        label: "Resilience & limits",
        question: "Does it degrade safely under load or failure?",
        match: /resource|limit|contingen|disaster|backup|recover|availab|incident/i,
      },
      { id: "security.general", label: "Other security controls", question: "Everything else in this pillar.", match: null },
    ],
  },
  {
    pillar: "data_protection",
    label: "Privacy & data",
    short: "Privacy",
    question: "Does personal and health data stay where it belongs?",
    hue: "#7a4bb0",
    domains: [
      {
        id: "data.redaction",
        label: "PII/PHI detection & redaction",
        question: "Is sensitive data stripped before it leaves the system?",
        match: /redact|pii|phi|sensitive|disclos|secret|leak/i,
      },
      {
        id: "data.minimisation",
        label: "Minimum necessary & purpose",
        question: "Does it retrieve only what the request actually needs?",
        match: /minimum|necessary|purpose|use polic|privacy/i,
      },
      {
        id: "data.residency",
        label: "Residency & transfer",
        question: "Does the data stay in the regions we promised?",
        match: /residen|transmission|transfer|encrypt|region|integrity/i,
      },
      {
        id: "data.rights",
        label: "Individual rights & accounting",
        question: "Can we answer an access, amendment or accounting request?",
        match: /right|amend|accounting|access request|record set|retention/i,
      },
      {
        id: "data.governance",
        label: "Corpus & data governance",
        question: "Is the knowledge base itself governed?",
        match: /data governance|data.?flow|corpus|media|inventory|quality/i,
      },
      { id: "data.general", label: "Other data-protection controls", question: "Everything else in this pillar.", match: null },
    ],
  },
  {
    pillar: "governance",
    label: "Accountability",
    short: "Account.",
    question: "Is someone answerable, and is change controlled?",
    hue: "#177a54",
    domains: [
      {
        id: "gov.accountability",
        label: "Roles & accountability",
        question: "Is a named person answerable for this system?",
        match: /responsib|accountab|role|officer|governance|authority/i,
      },
      {
        id: "gov.risk",
        label: "Risk management",
        question: "Is AI risk identified, treated and reviewed?",
        match: /risk|treatment|register|impact|fria|emergent/i,
      },
      {
        id: "gov.change",
        label: "Change control",
        question: "Does every change get reviewed and recorded?",
        match: /change|corrective|version|approval|management system/i,
      },
      {
        id: "gov.documentation",
        label: "Documentation & inventory",
        question: "Is the system documented and inventoried?",
        match: /document|inventory|technical file|declaration|context|boundar/i,
      },
      {
        id: "gov.training",
        label: "Training & awareness",
        question: "Do the people operating it know the rules?",
        match: /train|awareness|workforce train|education/i,
      },
      { id: "gov.general", label: "Other governance controls", question: "Everything else in this pillar.", match: null },
    ],
  },
  {
    pillar: "compliance",
    label: "Audit readiness",
    short: "Audit",
    question: "Can we prove all of this to a regulator?",
    hue: "#a5762a",
    domains: [
      {
        id: "comp.scoping",
        label: "Applicability & obligations",
        question: "Do we know which rules apply, and why?",
        match: /scope|applicab|obligation|registration|conformity|prohibited/i,
      },
      {
        id: "comp.audit",
        label: "Audit trail",
        question: "Can we reconstruct what the system did, and when?",
        match: /audit|log|monitor|trace|record retention/i,
      },
      {
        id: "comp.notice",
        label: "Notice, consent & reporting",
        question: "Are people told, and are incidents reported on time?",
        match: /notice|consent|breach|serious incident|report|notif/i,
      },
      {
        id: "comp.evidence",
        label: "Evidence freshness",
        question: "Is our proof current, or has it gone out of date?",
        match: /evaluation|periodic|evidence|review|surveillance|post.?market/i,
      },
      {
        id: "comp.thirdparty",
        label: "Third-party assurance",
        question: "Are our vendors and processors under contract?",
        match: /business associate|agreement|vendor|importer|distributor|deployer|supply/i,
      },
      { id: "comp.general", label: "Other compliance controls", question: "Everything else in this pillar.", match: null },
    ],
  },
];

export const pillarOrder: Pillar[] = pillarRegistry.map((entry) => entry.pillar);

export const pillarByKey = new Map<Pillar, PillarDefinition>(
  pillarRegistry.map((entry) => [entry.pillar, entry]),
);

export function pillarLabel(pillar: Pillar): string {
  return pillarByKey.get(pillar)?.label ?? pillar;
}

export function pillarHue(pillar: Pillar): string {
  return pillarByKey.get(pillar)?.hue ?? "#62716d";
}

/** Compact label for tight columns and chart axes, where the full heading will not fit. */
export function pillarShort(pillar: Pillar): string {
  return pillarByKey.get(pillar)?.short ?? pillar;
}

/** Primary pillar for a control. Controls may tag several; the first registered wins. */
export function primaryPillar(control: Pick<Control, "pillars">): Pillar {
  for (const pillar of pillarOrder) {
    if (control.pillars.includes(pillar)) return pillar;
  }
  return "governance";
}

/** Assign a control to a domain inside a pillar. The fallback domain always matches. */
export function domainFor(pillar: Pillar, control: Pick<Control, "name" | "category">): DomainDefinition {
  const definition = pillarByKey.get(pillar);
  if (!definition) {
    return { id: `${pillar}.general`, label: "Other controls", question: "", match: null };
  }
  const haystack = `${control.category} ${control.name}`;
  for (const domain of definition.domains) {
    if (domain.match && domain.match.test(haystack)) return domain;
  }
  return definition.domains[definition.domains.length - 1];
}

export const domainById = new Map<string, DomainDefinition & { pillar: Pillar }>(
  pillarRegistry.flatMap((entry) =>
    entry.domains.map((domain) => [domain.id, { ...domain, pillar: entry.pillar }] as const),
  ),
);
