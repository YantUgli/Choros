import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/status/Badge.jsx`.
 * Compact status/label chip. Mono, small caps optional. Small radius, never a pill.
 */

export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "limit" | "error" | "thinking";

const tones: Record<BadgeTone, { color: string; bg: string; bd: string }> = {
  neutral: { color: "var(--muted)", bg: "var(--panel-2)", bd: "var(--line)" },
  brand: { color: "var(--brand)", bg: "var(--brand-fill)", bd: "var(--brand-dim)" },
  ok: { color: "var(--ok)", bg: "var(--ok-fill)", bd: "transparent" },
  warn: { color: "var(--warn)", bg: "var(--warn-fill)", bd: "transparent" },
  limit: { color: "var(--limit)", bg: "var(--limit-fill)", bd: "transparent" },
  error: { color: "var(--error)", bg: "var(--error-fill)", bd: "transparent" },
  thinking: { color: "var(--thinking)", bg: "var(--thinking-fill)", bd: "transparent" },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Badge({ tone = "neutral", mono = true, children, style, ...rest }: BadgeProps) {
  const t = tones[tone] ?? tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        height: 20,
        padding: "0 7px",
        borderRadius: "var(--radius-sm)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "var(--fs-12)",
        fontWeight: 500,
        lineHeight: 1,
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
