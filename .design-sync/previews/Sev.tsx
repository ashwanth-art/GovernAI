import { Sev } from 'govern-ai-assessment';

export const SeverityScale = () => (
  // The four ranks. Same shape, four sizes, so rank reads without a legend.
  <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
    {['critical', 'high', 'medium', 'low'].map((s) => (
      <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        <Sev severity={s} />
        <span style={{ fontSize: 13 }}>{s}</span>
      </span>
    ))}
  </div>
);

export const LeadingAFinding = () => (
  // The in-situ position: glyph leading a finding title.
  <div style={{ display: 'grid', gap: 11, maxWidth: 540 }}>
    {[
      ['critical', 'Training data lineage is undocumented for two production models'],
      ['high', 'Model card omits intended-use boundaries'],
      ['medium', 'Retention schedule is not enforced on inference logs'],
      ['low', 'Evaluation set lacks a documented refresh cadence'],
    ].map(([sev, title]) => (
      <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Sev severity={sev} />
        <span style={{ fontSize: 13.5 }}>{title}</span>
      </div>
    ))}
  </div>
);
