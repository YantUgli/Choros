import type { ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/data/KeyValue.jsx`.
 * Aligned label→value row for machine metadata. Label sans-muted, value mono.
 */
export interface KeyValueProps {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  labelWidth?: number;
  mono?: boolean;
}

export function KeyValue({
  label,
  value,
  valueColor = "var(--text)",
  labelWidth = 120,
  mono = true,
}: KeyValueProps) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", padding: "3px 0" }}>
      <span
        style={{
          flex: `0 0 ${labelWidth}px`,
          color: "var(--muted)",
          fontSize: "var(--fs-12)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: valueColor,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: "var(--fs-13)",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}
