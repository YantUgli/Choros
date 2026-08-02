import type { CSSProperties } from "react";
import { ChorosMark } from "./ChorosMark";

/**
 * Wordmark sans "choros" — Inter 600, letter-spacing −0.02em, lowercase selalu.
 * `withMark` menempelkan mark χ asli di kirinya (lockup topbar).
 */
export interface ChorosWordmarkProps {
  size?: number;
  withMark?: boolean;
  markSize?: number;
  style?: CSSProperties;
}

export function ChorosWordmark({
  size = 18,
  withMark = true,
  markSize = 22,
  style,
}: ChorosWordmarkProps) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>
      {withMark && <ChorosMark size={markSize} title="choros" />}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: size,
          fontWeight: 600,
          letterSpacing: "var(--tracking-wordmark)",
          color: "var(--text)",
        }}
      >
        choros
      </span>
    </span>
  );
}
