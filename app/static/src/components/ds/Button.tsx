import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/core/Button.jsx`.
 * choros primary action button. Sharp, quiet, instrument-grade.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-2)",
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
  border: "1px solid transparent",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  userSelect: "none",
  transition:
    "background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease)",
};

const sizes: Record<ButtonSize, CSSProperties> = {
  sm: { height: 26, padding: "0 10px", fontSize: "var(--fs-12)" },
  md: { height: 32, padding: "0 14px", fontSize: "var(--fs-13)" },
  lg: { height: 38, padding: "0 18px", fontSize: "var(--fs-15)" },
};

const variants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--brand)",
    color: "var(--on-brand)",
    borderColor: "var(--brand)",
    fontWeight: 600,
  },
  secondary: {
    background: "var(--panel-2)",
    color: "var(--text)",
    borderColor: "var(--line)",
  },
  ghost: {
    background: "transparent",
    color: "var(--muted)",
    borderColor: "transparent",
  },
  danger: {
    background: "transparent",
    color: "var(--error)",
    borderColor: "var(--line)",
  },
};

function hoverFor(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return { background: "var(--brand-hover)", borderColor: "var(--brand-hover)" };
    case "secondary":
      return { borderColor: "var(--line-strong)", background: "#1F232A" };
    case "ghost":
      return { background: "var(--hover-fill)", color: "var(--text)" };
    case "danger":
      return { borderColor: "var(--error)", background: "var(--error-fill)" };
    default:
      return {};
  }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  /** default "button" seperti DS; boleh "submit" untuk form modal. */
  type?: "button" | "submit" | "reset";
}

export function Button({
  variant = "secondary",
  size = "md",
  disabled = false,
  icon = null,
  type = "button",
  children,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const v = variants[variant] ?? variants.secondary;
  const hoverStyle = !disabled && hover ? hoverFor(variant) : null;
  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...base,
        ...sizes[size],
        ...v,
        ...(hoverStyle ?? {}),
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
