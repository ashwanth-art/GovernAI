import { Pill } from 'govern-ai-assessment';

export const StatusScale = () => (
  // Every status the assessment API can return, in reporting order.
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Pill status="pass" />
    <Pill status="partial" />
    <Pill status="fail" />
    <Pill status="not_assessed" />
    <Pill status="not_applicable" />
  </div>
);

export const InControlRow = () => (
  // How it reads in a control row — the status is the row's verdict.
  <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
    {[
      ['GOVERN-1.1', 'Policies for AI risk management are documented', 'pass'],
      ['MEASURE-2.7', 'Model performance is monitored in deployment', 'partial'],
      ['MAP-3.4', 'Third-party model provenance is recorded', 'fail'],
      ['MANAGE-4.1', 'Incident response covers model failure modes', 'not_assessed'],
    ].map(([id, label, status]) => (
      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="mono" style={{ fontSize: 11.5, minWidth: 96 }}>{id}</span>
        <span style={{ flex: 1, fontSize: 13.5 }}>{label}</span>
        <Pill status={status} />
      </div>
    ))}
  </div>
);
