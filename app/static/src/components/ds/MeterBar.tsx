/**
 * Port 1:1 dari DS `components/data/MeterBar.jsx`.
 * Horizontal quota/usage meter. Fill color is semantic by threshold:
 * >= 100% limit · >= 85% warn · sisanya brand.
 */
export type MeterTone = "brand" | "warn" | "limit" | "ok" | "error";

export interface MeterBarProps {
  value?: number;
  max?: number;
  label?: string;
  unit?: string;
  tone?: MeterTone;
  height?: number;
  showValue?: boolean;
}

export function MeterBar({
  value = 0,
  max = 100,
  label,
  unit = "",
  tone,
  height = 6,
  showValue = true,
}: MeterBarProps) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const auto: MeterTone = pct >= 1 ? "limit" : pct >= 0.85 ? "warn" : "brand";
  const t = tone ?? auto;
  const color = {
    brand: "var(--brand)",
    warn: "var(--warn)",
    limit: "var(--limit)",
    ok: "var(--ok)",
    error: "var(--error)",
  }[t];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {(label || showValue) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-12)",
          }}
        >
          <span style={{ color: "var(--muted)" }}>{label}</span>
          {showValue && (
            <span style={{ color }}>
              {value.toLocaleString()}
              {unit ? " " + unit : ""} <span style={{ color: "var(--muted)" }}>/ {max.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}
      <div
        style={{
          height,
          background: "var(--panel-2)",
          borderRadius: 2,
          overflow: "hidden",
          border: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            width: pct * 100 + "%",
            height: "100%",
            background: color,
            transition: "width var(--dur) var(--ease)",
          }}
        />
      </div>
    </div>
  );
}
