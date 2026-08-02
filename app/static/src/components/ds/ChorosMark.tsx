import type { CSSProperties } from "react";

/**
 * Mark χ — aset ASLI `assets/choros-mark-chi-ondark.svg`, path identik.
 * Jangan menggambar ulang mark. `tone` hanya memilih stroke dari token,
 * geometri tidak pernah berubah.
 */
export interface ChorosMarkProps {
  size?: number;
  tone?: "text" | "brand" | "muted";
  title?: string;
  style?: CSSProperties;
}

const stroke = {
  text: "var(--text)",
  brand: "var(--brand)",
  muted: "var(--muted)",
} as const;

export function ChorosMark({ size = 22, tone = "text", title, style }: ChorosMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={stroke[tone]}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      {title && <title>{title}</title>}
      <path d="M1 15 L15 1 M5 19 L19 5 M9 23 L23 9 M4 4 L20 20" />
    </svg>
  );
}
