import { Disc, Kv, Sev, Tag } from 'govern-ai-assessment';

export const Finding = () => (
  // The canonical finding drill-down, closed — how the report first shows it.
  // The summary row has to stand alone, because this is the state readers scan.
  <div style={{ maxWidth: 620 }}>
    <Disc
      glyph={<Sev severity="high" />}
      title="Model card omits intended-use boundaries"
      sub="Downstream teams cannot tell which uses were evaluated"
      right="6 controls · 3 packs"
    >
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        The published model card documents training data and evaluation metrics but states no
        intended-use boundary, so any limitation on deployment context is unwritten.
      </p>
      <Kv
        items={[
          { k: 'Severity', v: 'high' },
          { k: 'Area', v: 'Trust & transparency' },
          { k: 'Owner', v: 'ML Platform' },
          { k: 'Raised by', v: 'doc-scan, interview', mono: true },
        ]}
      />
    </Disc>
  </div>
);

export const LongImpact = () => (
  // A `sub` that runs long is capped at two lines while collapsed, so one
  // verbose finding cannot break the scan rhythm of a list. Opening the finding
  // releases the cap — the text is deferred, never truncated away.
  <div style={{ maxWidth: 620 }}>
    <Disc
      glyph={<Sev severity="critical" />}
      title="Retrieval corpus integrity against approved baseline did not hold"
      sub="Live digest verification found 8 corpus documents that no longer match the approved baseline: 05_healthcare.md, 07_case_study_hospitality.md, 08_case_study_sap_finance.md, 09_case_study_retail_loyalty.md, 10_case_study_pds_platform.md, 11_case_study_medical_device.md, 12_service_catalog.md, 13_industry_catalog.md. Retrieval is serving content that changed after approval, without re-review or re-ingestion."
      right="3 controls · 3 packs"
    >
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Opened, the full impact line above is visible in its entirety.
      </p>
    </Disc>
  </div>
);

export const Expanded = () => (
  // Open, showing the clause references a finding breaches.
  <div style={{ maxWidth: 620 }}>
    <Disc
      open
      glyph={<Sev severity="critical" />}
      title="Training data lineage is undocumented for two production models"
      sub="No provenance record exists for the fine-tuning corpus"
      right="11 controls · 4 packs"
    >
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        Neither model records the origin, licence, or consent basis of its fine-tuning corpus.
        Data-subject requests cannot be traced to a source.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <Tag pack="NIST AI RMF" id="MAP-3.4" />
        <Tag pack="GDPR" id="Art. 30" />
        <Tag pack="DPDPA" id="S-8(4)" />
      </div>
    </Disc>
  </div>
);
