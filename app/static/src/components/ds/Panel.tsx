import type { CSSProperties, ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/layout/Panel.jsx`.
 * Primary bordered surface. The 1px line is the separator — no heavy shadow.
 * Header 40px: status · title · subtitle mono · actions kanan.
 */
export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}

export function Panel({
  title,
  subtitle,
  actions,
  status,
  children,
  padded = true,
  style,
  bodyStyle,
}: PanelProps) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--panel)",
        border: "var(--border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            height: 40,
            padding: "0 var(--space-4)",
            borderBottom: "var(--border)",
            flex: "0 0 auto",
          }}
        >
          {status}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                fontSize: "var(--fs-13)",
                fontWeight: 600,
                color: "var(--text)",
                letterSpacing: "var(--tracking-label)",
              }}
            >
              {title}
            </span>
            {subtitle && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  color: "var(--muted)",
                }}
              >
                {subtitle}
              </span>
            )}
          </div>
          {actions && (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              {actions}
            </div>
          )}
        </header>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: padded ? "var(--space-4)" : 0, ...bodyStyle }}>
        {children}
      </div>
    </section>
  );
}
