import type { CSSProperties, ReactNode } from "react";

/**
 * Label chrome: 12px UPPERCASE, tracking 0.02em, muted, Inter.
 * Satu-satunya cara menulis label bagian di app ini.
 */
export function Label({
  children,
  strong = true,
  style,
}: {
  children: ReactNode;
  /** heading bagian (600) vs label kontrol (400) */
  strong?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "var(--fs-12)",
        fontWeight: strong ? 600 : 400,
        letterSpacing: "var(--tracking-label)",
        color: "var(--muted)",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Teks data mesin: mono 12px muted. */
export function Meta({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-12)",
        color: "var(--muted)",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Field: label chrome di atas kontrol, gap 4px. */
export function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", minWidth: 0, ...style }}>
      <Label strong={false}>{label}</Label>
      {children}
    </label>
  );
}
