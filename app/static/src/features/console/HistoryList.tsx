import { Badge, Card, StatusDot, type DotStatus } from "../../components/ds";
import { Label, Meta } from "../../components/Label";
import { SESSIONS } from "../../data/fixtures";
import type { TaskCategory } from "../../state/types";

export function HistoryList({
  selected,
  onSelect,
  liveRunId,
  liveCategory,
  liveLabel,
  liveDot,
}: {
  /** null = run aktif (live) */
  selected: number | null;
  onSelect: (id: number | null) => void;
  liveRunId: number;
  liveCategory: TaskCategory;
  liveLabel: string;
  liveDot: DotStatus;
}) {
  return (
    <div
      style={{
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <Label>Riwayat</Label>

      <Card interactive active={selected === null} onClick={() => onSelect(null)}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", padding: 2 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <span style={{ fontSize: "var(--fs-13)" }}>run aktif</span>
            <StatusDot status={liveDot} />
          </div>
          <Meta>
            #{liveRunId} · {liveCategory} · {liveLabel}
          </Meta>
        </div>
      </Card>

      {SESSIONS.map((s) => (
        <Card key={s.id} interactive active={selected === s.id} onClick={() => onSelect(s.id)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: 2 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "var(--space-2)",
              }}
            >
              <span style={{ fontSize: "var(--fs-13)", lineHeight: 1.35 }}>{s.prompt}</span>
              <div style={{ flex: "none" }}>
                <Badge tone={s.statusTone}>{s.status}</Badge>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-12)",
                color: "var(--muted)",
              }}
            >
              <span>
                #{s.id} · {s.mode}
              </span>
              {s.chain.length > 1 && (
                <span style={{ color: "var(--limit)" }}>⤳ {s.chain.length} agent</span>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
