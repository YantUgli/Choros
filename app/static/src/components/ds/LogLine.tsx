import type { CSSProperties, ReactNode } from "react";

/**
 * Port 1:1 dari DS `components/data/LogLine.jsx`.
 * One line of streamed console output. Mono, dense, aligned columns:
 * timestamp · level gutter · source · message.
 */

export type LogLevel = "info" | "ok" | "warn" | "limit" | "error" | "thinking" | "out";

const levelColor: Record<LogLevel, string> = {
  info: "var(--muted)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  limit: "var(--limit)",
  error: "var(--error)",
  thinking: "var(--thinking)",
  out: "var(--text)",
};

export interface LogLineProps {
  ts: string;
  level?: LogLevel;
  source?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function LogLine({ ts, level = "info", source, children, style }: LogLineProps) {
  const c = levelColor[level] ?? levelColor.info;
  return (
    <div
      style={{
        display: "grid",
        // Kolom sumber (tag + model) DIBATASI: nama model panjang tidak boleh
        // menyita kolom pesan sampai teks jawaban terjepit jadi satu huruf/baris.
        gridTemplateColumns: "68px 3px minmax(0, 190px) minmax(0, 1fr)",
        gap: "var(--space-2)",
        alignItems: "baseline",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-13)",
        lineHeight: 1.55,
        padding: "1px 0",
        ...style,
      }}
    >
      <span style={{ color: "var(--muted)", opacity: 0.7 }}>{ts}</span>
      <span
        style={{
          alignSelf: "stretch",
          background: c,
          borderRadius: 1,
          opacity: level === "info" ? 0.25 : 0.9,
        }}
      />
      {source ? (
        <span
          title={source}
          style={{
            color: "var(--muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {source}
        </span>
      ) : (
        <span />
      )}
      <span
        style={{
          color: level === "info" ? "var(--text)" : c,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {children}
      </span>
    </div>
  );
}
