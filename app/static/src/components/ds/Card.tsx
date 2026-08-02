import { useState, type HTMLAttributes, type ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/layout/Card.jsx`.
 * Lighter nested surface — a cell inside a Panel. Border-defined, hover-liftable.
 * `active` = selectable teal wash.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  active?: boolean;
  children?: ReactNode;
}

export function Card({
  interactive = false,
  active = false,
  children,
  style,
  onClick,
  onKeyDown,
  ...rest
}: CardProps) {
  const [hover, setHover] = useState(false);
  // Card interaktif dipakai sebagai tombol (riwayat, kategori, target routing) —
  // jadi ia harus bisa difokus & ditekan dari keyboard. DS aslinya hanya div.
  const a11y = interactive
    ? { role: "button" as const, tabIndex: 0, "aria-pressed": active }
    : {};
  return (
    <div
      {...a11y}
      onClick={onClick}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!interactive || e.defaultPrevented) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).click();
        }
      }}
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: active ? "var(--brand-fill)" : "var(--panel-2)",
        border: `1px solid ${
          active ? "var(--brand-dim)" : hover ? "var(--line-strong)" : "var(--line)"
        }`,
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-3)",
        cursor: interactive ? "pointer" : "default",
        transition: "border-color var(--dur) var(--ease), background var(--dur) var(--ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
