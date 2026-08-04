/**
 * Port 1:1 dari DS `components/data/MeterBar.jsx`.
 * Horizontal quota/usage meter. Fill color is semantic by threshold:
 * >= 100% limit · >= 85% warn · sisanya brand.
 */
import { useEffect, useState } from "react";

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

  // Mulai dari 0 pada mount, animate ke nilai target setelah frame pertama.
  // Juga animate setiap kali value berubah (polling 60s).
  const [live, setLive] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLive(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

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
              {unit ? " " + unit : ""}{" "}
              <span style={{ color: "var(--muted)" }}>/ {max.toLocaleString()}</span>
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
            width: live * 100 + "%",
            height: "100%",
            background: color,
            transition: "width 700ms cubic-bezier(0.2, 0, 0, 1)",
          }}
        />
      </div>
    </div>
  );
}
