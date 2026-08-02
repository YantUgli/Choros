import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/core/IconButton.jsx`.
 * Square, icon-only control. Same graphite chrome as Button ghost/secondary.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: "ghost" | "secondary";
  size?: number;
  active?: boolean;
  children?: ReactNode;
}

export function IconButton({
  variant = "ghost",
  size = 32,
  active = false,
  children,
  style,
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const bg = active ? "var(--brand-fill)" : hover ? "var(--hover-fill)" : "transparent";
  const color = active ? "var(--brand)" : hover ? "var(--text)" : "var(--muted)";
  const bd = variant === "secondary" ? "var(--line)" : "transparent";
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        padding: 0,
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--brand-dim)" : bd}`,
        background: bg,
        color,
        cursor: "pointer",
        transition: "all var(--dur) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
