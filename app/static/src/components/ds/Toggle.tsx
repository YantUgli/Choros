/**
 * Port 1:1 dari DS `components/forms/Toggle.jsx`.
 * Binary switch. Teal when on — active state, not decoration.
 */
export interface ToggleProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Toggle({ checked = false, onChange, disabled = false, ...aria }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      style={{
        position: "relative",
        width: 34,
        height: 20,
        padding: 0,
        borderRadius: "var(--radius-full)",
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--brand)" : "var(--panel-2)",
        border: `1px solid ${checked ? "var(--brand)" : "var(--line)"}`,
        opacity: disabled ? 0.4 : 1,
        transition: "background var(--dur) var(--ease), border-color var(--dur) var(--ease)",
        flex: "0 0 auto",
      }}
      {...aria}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: "var(--radius-full)",
          background: checked ? "var(--on-brand)" : "var(--muted)",
          transition: "left var(--dur) var(--ease)",
        }}
      />
    </button>
  );
}
