import type { CSSProperties } from "react";

/**
 * Port 1:1 dari DS `components/status/StatusDot.jsx`.
 * Status pip. running/thinking pulse; the rest are steady.
 * The disciplined way status color enters the UI.
 *
 * Keyframes `choros-pulse` hidup di styles/global.css (satu definisi untuk seluruh app,
 * bukan <style> per-instance seperti di bundle DS).
 */

export type DotStatus = "ok" | "running" | "warn" | "limit" | "error" | "thinking" | "idle";

const colorFor: Record<DotStatus, string> = {
  ok: "var(--ok)",
  running: "var(--running)",
  warn: "var(--warn)",
  limit: "var(--limit)",
  error: "var(--error)",
  thinking: "var(--thinking)",
  idle: "var(--muted)",
};

export interface StatusDotProps {
  status?: DotStatus;
  size?: number;
  pulse?: boolean;
  label?: string;
  style?: CSSProperties;
}

export function StatusDot({ status = "idle", size = 8, pulse, label, style }: StatusDotProps) {
  const c = colorFor[status] ?? colorFor.idle;
  const animate = pulse ?? (status === "running" || status === "thinking");
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-full)",
        background: c,
        color: c,
        boxShadow: animate ? `0 0 0 0 ${c}` : "none",
        animation: animate ? "choros-pulse 1.6s var(--ease) infinite" : "none",
        flex: "0 0 auto",
      }}
    />
  );
  if (!label) return dot;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        color: "var(--muted)",
        ...style,
      }}
    >
      {dot}
      {label}
    </span>
  );
}
