import { Tag } from 'govern-ai-assessment';

export const AcrossPacks = () => (
  // Clause references across the packs an assessment can run. Always both
  // parts — a bare control id is ambiguous across packs.
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 520 }}>
    <Tag pack="NIST AI RMF" id="GOVERN-1.1" />
    <Tag pack="NIST AI RMF" id="MEASURE-2.7" />
    <Tag pack="GDPR" id="Art. 35" />
    <Tag pack="HIPAA" id="164.312(a)(1)" />
    <Tag pack="DPDPA" id="S-8(4)" />
    <Tag pack="ISO 42001" id="A.6.2.2" />
  </div>
);

export const UnderAFinding = () => (
  // What a single control breach looks like inline, under a finding.
  <div style={{ maxWidth: 520 }}>
    <em style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }}>
      Breaches
    </em>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      <Tag pack="NIST AI RMF" id="MAP-3.4" />
      <Tag pack="GDPR" id="Art. 30" />
    </div>
  </div>
);
