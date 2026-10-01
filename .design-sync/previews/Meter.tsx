import { Meter } from 'govern-ai-assessment';

export const PillarHealth = () => (
  // Pillar health across the five assessment pillars, each bar hued to its
  // pillar. In the app the hue comes from `pillarHue(pillar)`; in a design use
  // the matching `--p-*` token, which is the same palette reachable from CSS.
  <div style={{ display: 'grid', gap: 16, maxWidth: 460 }}>
    {[
      ['Accountability', 82, 'var(--p-governance)'],
      ['Trust & transparency', 71, 'var(--p-trust)'],
      ['Privacy & data', 64, 'var(--p-data)'],
      ['Security', 41, 'var(--p-security)'],
      ['Audit readiness', 18, 'var(--p-compliance)'],
    ].map(([label, percent, hue]) => (
      <div key={label} style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
          <span>{label}</span>
          <span className="mono">{percent}%</span>
        </div>
        <Meter percent={percent} hue={hue} />
      </div>
    ))}
  </div>
);

export const Complete = () => (
  // Default hue at the cap — the fill spans the full track.
  <div style={{ maxWidth: 460 }}><Meter percent={100} /></div>
);
