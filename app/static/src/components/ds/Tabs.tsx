/**
 * Port 1:1 dari DS `components/navigation/Tabs.jsx`.
 * Underline tab strip. Active tab carries a teal underline + brighter text.
 * Count dirender mono.
 */
export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  tabs?: TabItem<T>[];
  value?: T;
  onChange?: (next: T) => void;
  "aria-label"?: string;
}

export function Tabs<T extends string = string>({
  tabs = [],
  value,
  onChange,
  ...aria
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      style={{ display: "flex", gap: "var(--space-1)", borderBottom: "var(--border)" }}
      {...aria}
    >
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(t.value)}
            style={{
              position: "relative",
              height: 34,
              padding: "0 var(--space-3)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--fs-13)",
              fontWeight: on ? 600 : 500,
              color: on ? "var(--text)" : "var(--muted)",
              borderBottom: `2px solid ${on ? "var(--brand)" : "transparent"}`,
              marginBottom: -1,
              transition: "color var(--dur) var(--ease)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            {t.label}
            {t.count != null && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  color: "var(--muted)",
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
