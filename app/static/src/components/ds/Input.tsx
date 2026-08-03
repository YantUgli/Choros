import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/forms/Input.jsx`.
 * Text/number input. Mono by default (it usually holds machine data).
 * Fokus = border teal.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  mono?: boolean;
  size?: "sm" | "md" | "lg";
  prefix?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = true, size = "md", prefix = null, invalid = false, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focus, setFocus] = useState(false);
  const h = size === "sm" ? 28 : size === "lg" ? 38 : 32;
  const border = invalid ? "var(--error)" : focus ? "var(--brand)" : "var(--line)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: h,
        padding: "0 10px",
        background: "var(--bg)",
        border: `1px solid ${border}`,
        borderRadius: "var(--radius-sm)",
        transition: "border-color var(--dur) var(--ease)",
      }}
    >
      {prefix && (
        <span
          style={{
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-13)",
          }}
        >
          {prefix}
        </span>
      )}
      <input
        ref={ref}
        onFocus={(e) => {
          setFocus(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          onBlur?.(e);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text)",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: "var(--fs-13)",
          ...style,
        }}
        {...rest}
      />
    </div>
  );
});
