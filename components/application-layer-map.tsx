"use client";

import { useMemo, useState } from "react";
import { buildApplicationMap, layersForControl, type ApplicationLayerId, type MapStandard } from "@/lib/application-map";
import { assessmentMethod } from "@/lib/deployment-evaluation";
import { pillarLabel, primaryPillar } from "@/lib/pillars";
import type { AccessTier, Pillar, ControlResult } from "@/lib/types";

const labels: Record<string, string> = { pass: "Passed", fail: "Failed", partial: "Inconclusive", not_assessed: "Not assessed", not_applicable: "Not applicable", needs_deeper_tier: "Needs deeper tier" };

export function TechnicalAssessmentList({ checks }: { checks: ControlResult[] }) {
  return <div className="technical-assessments">{checks.map(check => <details key={check.id} className="technical-assessment">
    <summary><span>{check.name}</span><span className={`layer-map-state ${check.status}`}>{labels[check.status]}</span></summary>
    <p><b>Method:</b> {check.objective ?? assessmentMethod(check)}</p>
    <p><b>Result:</b> {check.evidence}</p>
    <small>Rule: {check.evaluationRuleId} · Report pillar: {pillarLabel(primaryPillar(check))}</small>
  </details>)}</div>;
}

export function ApplicationLayerMap({ standards, tier, systemName, completed = false, onOpenPillar, technicalChecks = [] }: {
  standards: MapStandard[]; tier: AccessTier; systemName: string; completed?: boolean; onOpenPillar?: (pillar: Pillar) => void; technicalChecks?: ControlResult[];
}) {
  const map = useMemo(() => buildApplicationMap(standards, tier), [standards, tier]);
  const [selected, setSelected] = useState<ApplicationLayerId>("identity");
  const active = map.layers.find(layer => layer.id === selected)!;
  const layerChecks = technicalChecks.filter(check => layersForControl(check).layers.includes(selected));
  return <section className="layer-map" aria-label="Application security layer map">
    <div className="layer-map-heading"><div><p className="eyebrow">Application → layers → selected controls</p><h3>How your application is evaluated</h3></div><span className="tag-s">Tier {tier} · {standards.length} selected packs</span></div>
    <p className="layer-map-note">Seven technical security layers connect to the existing five report pillars. This is a map of selected assessment objectives—not a discovered inventory or proof that every aspect of the application has been audited.</p>
    <div className="layer-map-path" aria-hidden="true"><span>{systemName || "Your application"}</span><i>→</i><span>7 security layers</span><i>→</i><span>{map.total} selected control objectives</span></div>
    <div className="layer-map-grid" aria-label="Security layers">
      {map.layers.map((layer, index) => <button type="button" key={layer.id} aria-pressed={selected === layer.id} aria-controls="layer-map-controls" onClick={() => setSelected(layer.id)} className={`layer-map-node${selected === layer.id ? " selected" : ""}${layer.failed ? " has-failures" : ""}`}>
        <span className="layer-map-number">0{index + 1}</span><strong>{layer.name}</strong><small>{layer.examples}</small>
        <span className="layer-map-counts">{completed ? `${layer.passed} passed · ${layer.failed} failed · ${layer.pending} pending` : `${layer.controls.length} related controls`}</span>
      </button>)}
    </div>
    <p className="layer-map-note">{completed ? `${map.evaluated}/${map.total} selected controls reached pass/fail verdicts. Open each row for its assessment method, result and any supporting technical checks. ` : "Assessment outcomes will appear after the run. Technical checks run automatically through the connected sources; no separate deployment pack is needed. "}An objective may relate to several layers, so layer counts must not be added together.</p>
    <div id="layer-map-controls" className="layer-map-detail" aria-live="polite">
      <h4>{active.name} → selected standard controls</h4><p className="layer-map-note">Evidence sources: {active.sources}. Read-only connections and source measurements are required where public observations are insufficient.</p>
      {!active.controls.length ? <p>No objectives in the current selection map to this layer. This is a coverage gap—not a passed layer.</p> : standards.map(standard => {
        const rows = active.controls.filter(control => control.standardId === standard.id);
        if (!rows.length) return null;
        return <details className="layer-map-standard" key={standard.id} open={standards.length === 1}>
          <summary>{standard.shortName}<span>{rows.length} related controls</span></summary>
          <ul>{rows.map(control => <li key={control.id}>
            <div><code>{control.id}</code><strong>{control.name}</strong><small>{control.basis} · requires Tier {control.tierMinimum}</small>
              {onOpenPillar && ["pass", "fail"].includes(control.state) ? <button type="button" className="layer-map-pillar" onClick={() => onOpenPillar(primaryPillar(control))}>{pillarLabel(primaryPillar(control))} →</button> : <small>Report pillar: {pillarLabel(primaryPillar(control))}</small>}
              {completed && <>
                <p className="layer-map-result"><b>Method:</b> {control.method ?? assessmentMethod(control)} {control.objective}</p>
                <p className="layer-map-result"><b>Result:</b> {control.evidence || "No assessment explanation was recorded in this saved report."}</p>
                {!!control.supportingChecks?.length && <details className="layer-map-support"><summary>Supporting technical checks ({control.supportingChecks.length})</summary>
                  <p className="layer-map-note">Supporting observations only. Their outcomes do not replace this standard control’s own verdict or establish the entire obligation.</p>
                  <TechnicalAssessmentList checks={control.supportingChecks} />
                </details>}
              </>}
            </div>{control.state !== "planned" && <span className={`layer-map-state ${control.state}`}>{labels[control.state]}</span>}
          </li>)}</ul>
        </details>;
      })}
      {completed && layerChecks.length > 0 && <details className="layer-map-standard">
        <summary>Automatic technical checks<span>{layerChecks.length} checks</span></summary>
        <p className="layer-map-note">Collected once underneath the assessment, not a separate compliance pack. Checks without an explicit supporting relationship remain standalone technical observations.</p>
        <TechnicalAssessmentList checks={layerChecks} />
      </details>}
    </div>
  </section>;
}
