import { Ring } from 'govern-ai-assessment';

export const Live = () => (
  // A run in progress.
  <Ring percent={62} elapsed="4m 12s" tone="live" />
);

export const Done = () => (
  // Finished. The same arc position would read wrong in the live tone.
  <Ring percent={100} elapsed="11m 38s" tone="done" />
);

export const Failed = () => (
  // Stopped at 60%. `tone` is deliberately separate from `percent` so a failed
  // run never looks like a run that is merely 60% complete.
  <Ring percent={60} elapsed="6m 03s" tone="failed" />
);

export const Compact = () => (
  // Smaller, for a summary rail rather than the run screen.
  <Ring percent={84} size={112} tone="done" />
);
