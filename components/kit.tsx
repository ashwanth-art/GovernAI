import type { ReactNode } from "react";
import { statusMeaning } from "@/lib/terms";
import type { ControlStatus, Severity } from "@/lib/types";

/**
 * The primitive set.
 *
 * Deliberately small. The previous build had thirty exported primitives and used
 * eleven of them, because each new panel added the one shape it wanted rather than
 * reaching for an existing one. Everything here is used in at least two places; a
 * shape used once belongs inline in the screen that uses it.
 */

/* ---- status ------------------------------------------------------------- */

/** A status, spelled exactly as the API spells it, with its meaning as the tooltip. */
export function Pill({ status }: { status: ControlStatus | string }) {
  return (
    <span className={`pill ${status}`} title={statusMeaning[status] ?? undefined}>
      {status}
    </span>
  );
}

export const sevHue: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
};

/** Severity as a filled square. Four sizes of the same shape, so rank reads at a glance. */
export function Sev({ severity }: { severity: Severity }) {
  const size = { critical: 11, high: 10, medium: 8.5, low: 7 }[severity];
  return (
    <span
      aria-label={severity}
      title={severity}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 2.5,
        background: sevHue[severity],
        verticalAlign: "middle",
      }}
    />
  );
}

/** The four severity counts as a row of squares. Absent severities are omitted, not zeroed. */
export function SevRow({ counts }: { counts: Record<string, number> }) {
  const order: Severity[] = ["critical", "high", "medium", "low"];
  const present = order.filter((key) => (counts[key] ?? 0) > 0);
  if (!present.length) return <span className="faint" style={{ fontSize: 12 }}>none open</span>;
  return (
    <span className="area-sev">
      {present.map((key) => (
        <span key={key} title={`${counts[key]} ${key}`} style={{ background: sevHue[key] }} />
      ))}
    </span>
  );
}

/* ---- figures ------------------------------------------------------------ */

/**
 * The run's progress ring.
 *
 * `tone` is separate from `percent` because a run that failed at 60% must not look
 * like a run that is 60% done — the arc stops in the same place and changes colour.
 */
export function Ring({
  percent,
  elapsed,
  tone = "live",
  size = 188,
}: {
  percent: number;
  elapsed?: string;
  tone?: "live" | "done" | "failed";
  size?: number;
}) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`ring ${tone === "live" ? "" : tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle
          className="track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <div className="ring-mid">
        <span className="pc">
          {Math.round(clamped)}
          <sup>%</sup>
        </span>
        {elapsed ? <span className="el">{elapsed}</span> : null}
      </div>
    </div>
  );
}

/** A horizontal proportion. Never rendered when there is no denominator behind it. */
export function Meter({ percent, hue }: { percent: number; hue?: string }) {
  return (
    <div className="area-bar">
      <i
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          background: hue ?? "var(--green)",
        }}
      />
    </div>
  );
}

/* ---- containers --------------------------------------------------------- */

/**
 * The report's only drill-down.
 *
 * A native `<details>` rather than managed state: it is keyboard-operable, it is
 * findable by the browser's own in-page search when open, and it prints expanded
 * without the report having to know it is being printed.
 */
export function Disc({
  glyph,
  title,
  sub,
  right,
  open,
  children,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card disc" open={open}>
      <summary>
        <span className="sev">{glyph ?? "›"}</span>
        <span className="ti">
          {title}
          {sub ? <small>{sub}</small> : null}
        </span>
        <span className="rt">{right}</span>
      </summary>
      <div className="disc-body">{children}</div>
    </details>
  );
}

/** Label-over-value pairs. The label is always uppercase and always small. */
export function Kv({ items }: { items: Array<{ k: string; v: ReactNode; mono?: boolean }> }) {
  return (
    <div className="kv">
      {items.map((item) => (
        <div key={item.k}>
          <em>{item.k}</em>
          <span className={item.mono ? "mono" : undefined}>{item.v}</span>
        </div>
      ))}
    </div>
  );
}

/** A framework clause reference: pack short name plus the control id it names. */
export function Tag({ pack, id }: { pack: string; id: string }) {
  return (
    <span className="tag-s">
      {pack} <b>{id}</b>
    </span>
  );
}
