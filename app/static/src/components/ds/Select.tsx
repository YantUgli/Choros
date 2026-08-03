import { useState, type ReactNode, type SelectHTMLAttributes } from "react";

/**
 * Port 1:1 dari DS `components/forms/Select.jsx`.
 * Native select wearing choros chrome.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}

export function Select({ size = "md", children, style, onFocus, onBlur, ...rest }: SelectProps) {
  const [focus, setFocus] = useState(false);
  const h = size === "sm" ? 28 : size === "lg" ? 38 : 32;
  return (
    <div style={{ position: "relative", display: "inline-flex", height: h }}>
      <select
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
        style={{
          appearance: "none",
          height: "100%",
          padding: "0 28px 0 10px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: `1px solid ${focus ? "var(--brand)" : "var(--line)"}`,
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-13)",
          cursor: "pointer",
          outline: "none",
          ...style,
        }}
        {...rest}
      >
        {children}
      </select>
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--muted)",
        }}
      >
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}
