"use client";

import { useMemo, useState } from "react";
import { buildApplicationMap, type ApplicationLayerId, type MapStandard } from "@/lib/application-map";
import { pillarLabel, primaryPillar } from "@/lib/pillars";
import type { AccessTier, Pillar } from "@/lib/types";

const labels: Record<string, string> = { pass: "Passed", fail: "Failed", partial: "Inconclusive", not_assessed: "Evidence needed", not_applicable: "Not applicable", planned: "Planned · evidence required", needs_deeper_tier: "Needs deeper tier" };

export function ApplicationLayerMap({ standards, tier, systemName, completed = false, onOpenPillar }: {
  standards: MapStandard[]; tier: AccessTier; systemName: string; completed?: boolean; onOpenPillar?: (pillar: Pillar) => void;
}) {
  const map = useMemo(() => buildApplicationMap(standards, tier), [standards, tier]);
  const [selected, setSelected] = useState<ApplicationLayerId>("identity");
  const active = map.layers.find(layer => layer.id === selected)!;
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
    <p className="layer-map-note">{completed ? `${map.evaluated}/${map.total} selected controls reached pass/fail verdicts; the rest remain visible here as evidence gaps or inconclusive results. ` : "Planned does not mean passed: actual outcomes depend on collected evidence and access. "}An objective may relate to several layers, so layer counts must not be added together.</p>
    <div id="layer-map-controls" className="layer-map-detail" aria-live="polite">
      <h4>{active.name} → selected standard controls</h4><p className="layer-map-note">Evidence sources: {active.sources}. Read-only connections and source measurements are required where public observations are insufficient.</p>
      {!active.controls.length ? <p>No objectives in the current selection map to this layer. This is a coverage gap—not a passed layer.</p> : standards.map(standard => {
        const rows = active.controls.filter(control => control.standardId === standard.id);
        if (!rows.length) return null;
        return <details className="layer-map-standard" key={standard.id} open={standard.id === "deployment_review"}>
          <summary>{standard.shortName}<span>{rows.length} related controls</span></summary>
          <ul>{rows.map(control => <li key={control.id}>
            <div><code>{control.id}</code><strong>{control.name}</strong><small>{control.basis} · requires Tier {control.tierMinimum}</small>
              {onOpenPillar && ["pass", "fail"].includes(control.state) ? <button type="button" className="layer-map-pillar" onClick={() => onOpenPillar(primaryPillar(control))}>{pillarLabel(primaryPillar(control))} →</button> : <small>Report pillar: {pillarLabel(primaryPillar(control))}</small>}
            </div><span className={`layer-map-state ${control.state}`}>{labels[control.state]}</span>
          </li>)}</ul>
        </details>;
      })}
    </div>
  </section>;
}
