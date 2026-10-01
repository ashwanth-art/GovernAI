import { Kv } from 'govern-ai-assessment';

export const FindingDetail = () => (
  // The finding metadata block, as the report composes it.
  <div style={{ maxWidth: 560 }}>
    <Kv
      items={[
        { k: 'Severity', v: 'critical' },
        { k: 'Area', v: 'Privacy & data' },
        { k: 'Owner', v: 'ML Platform' },
        { k: 'Raised by', v: 'doc-scan, interview', mono: true },
      ]}
    />
  </div>
);

export const RunMetadata = () => (
  // Run metadata — mono values for anything an engineer will copy.
  <div style={{ maxWidth: 560 }}>
    <Kv
      items={[
        { k: 'Run id', v: 'run_8f3c21ab', mono: true },
        { k: 'Depth', v: 'Tier 2 · gray-box' },
        { k: 'Started', v: '09:35 IST' },
        { k: 'Duration', v: '11m 38s', mono: true },
        { k: 'Packs', v: 'NIST AI RMF, GDPR, DPDPA' },
      ]}
    />
  </div>
);
