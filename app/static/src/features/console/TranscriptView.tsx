import { Badge } from "../../components/ds";
import { Label } from "../../components/Label";
import type { Session } from "../../data/fixtures";

/**
 * Transkrip sesi lama: percakapan, bukan log stream.
 * Chip "Jejak agent" di atas + pembatas `cascade: agent → alasan → target berikut`
 * di titik pergantian.
 */
export function TranscriptView({ session }: { session: Session }) {
  return (
    <>
      <div
        style={{
          flex: "none",
          padding: "10px var(--space-4)",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          flexWrap: "wrap",
        }}
      >
        <Label style={{ marginRight: "var(--space-1)" }}>Jejak agent</Label>
        {session.chain.map((c, i) => (
          <div key={`${c.label}-${i}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Badge tone={c.tone}>{c.label}</Badge>
            {c.reason && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--limit)" }}>
                {c.reason} →
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        className="ov"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "14px var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {session.messages.map((m, i) => {
          if (m.kind === "user") {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "78%",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 10px",
                  fontSize: "var(--fs-13)",
                  lineHeight: 1.5,
                }}
              >
                {m.text}
              </div>
            );
          }
          if (m.kind === "switch") {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "center",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  border: "1px solid var(--limit)",
                  background: "var(--limit-fill)",
                  borderRadius: "var(--radius-sm)",
                  padding: "6px 10px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  color: "var(--text)",
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                <span style={{ color: "var(--limit)" }}>cascade</span>
                <span>{m.from}</span>
                <span style={{ color: "var(--limit)" }}>{m.reason}</span>
                <span>→</span>
                <span style={{ fontWeight: 600 }}>{m.to}</span>
              </div>
            );
          }
          if (m.kind === "note") {
            return (
              <div
                key={i}
                style={{
                  alignSelf: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-12)",
                  color: "var(--muted)",
                  textAlign: "center",
                }}
              >
                {m.text}
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                alignSelf: "flex-start",
                maxWidth: "82%",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-12)", color: "var(--brand)" }}>
                {m.src}
              </span>
              <div
                style={{
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 10px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-13)",
                  lineHeight: 1.55,
                  color: "var(--text)",
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
