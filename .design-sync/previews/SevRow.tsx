import { SevRow } from 'govern-ai-assessment';

export const ByPillar = () => (
  // Open findings per pillar, densest to sparsest.
  <div style={{ display: 'grid', gap: 14, maxWidth: 420 }}>
    {[
      ['Accountability', { critical: 1, high: 3, medium: 5, low: 2 }],
      ['Privacy & data', { high: 2, medium: 4, low: 1 }],
      ['Trust & transparency', { medium: 2, low: 3 }],
      ['Audit readiness', { low: 1 }],
    ].map(([label, counts]) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 13, minWidth: 150 }}>{label}</span>
        <SevRow counts={counts} />
      </div>
    ))}
  </div>
);

export const CriticalOnly = () => (
  // Absent severities are omitted rather than drawn as zero.
  <SevRow counts={{ critical: 2 }} />
);

export const NoneOpen = () => (
  // Empty counts render the phrase "none open", not an empty row.
  <SevRow counts={{}} />
);
