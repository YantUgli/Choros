import { Badge, KeyValue, MeterBar, Panel } from "../../components/ds";
import { Label } from "../../components/Label";
import { CONSUMPTION_7D, QUOTA_WINDOWS } from "../../data/fixtures";

const fmt = (n: number) => n.toLocaleString("en-US");

const windowGrid = {
  display: "grid",
  gridTemplateColumns: "260px 1fr 170px 190px",
  gap: "var(--space-3)",
  alignItems: "center",
  padding: "var(--space-2) 0",
  borderTop: "1px solid var(--line)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-13)",
} as const;

const tableGrid = {
  display: "grid",
  gridTemplateColumns: "1fr 90px 140px 110px",
  fontFamily: "var(--font-mono)",
  borderTop: "1px solid var(--line)",
} as const;

export function QuotaScreen() {
  const cooldowns = QUOTA_WINDOWS.filter((q) => q.cooldown);

  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 960, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Panel title="Quota" subtitle="tercatat lewat choros — bukan sisa kuota resmi provider">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Label style={{ marginBottom: 6 }}>Window aktif — per (agent, model)</Label>

              {QUOTA_WINDOWS.map((q) => (
                <div key={q.key} style={windowGrid}>
                  <span>
                    {q.agent} / {q.model}
                  </span>
                  <MeterBar value={q.used} max={q.max} showValue={false} height={8} />
                  <span style={{ textAlign: "right", color: "var(--muted)" }}>
                    {fmt(q.used)} / {fmt(q.max)} tok
                  </span>
                  <div style={{ justifySelf: "end" }}>
                    <Badge tone={q.badge.tone}>{q.badge.text}</Badge>
                  </div>
                </div>
              ))}

              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Label style={{ marginBottom: "var(--space-1)" }}>Cooldown aktif</Label>
                {cooldowns.map((q) => (
                  <KeyValue
                    key={q.key}
                    label={`${q.agent} / ${q.model}`}
                    value={`reset dalam ${q.cooldown}`}
                    valueColor="var(--limit)"
                    labelWidth={260}
                  />
                ))}
                {cooldowns.length === 0 && (
                  <KeyValue label="—" value="tidak ada target dalam cooldown" valueColor="var(--ok)" labelWidth={260} />
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <Label style={{ marginBottom: 6 }}>Konsumsi 7 hari</Label>
              <div
                style={{
                  ...tableGrid,
                  fontSize: "var(--fs-12)",
                  color: "var(--muted)",
                  letterSpacing: "var(--tracking-label)",
                  textTransform: "uppercase",
                  padding: "6px 0",
                }}
              >
                <span>agent / model</span>
                <span style={{ textAlign: "right" }}>run</span>
                <span style={{ textAlign: "right" }}>token</span>
                <span style={{ textAlign: "right" }}>kena limit</span>
              </div>
              {CONSUMPTION_7D.map((r) => (
                <div key={r.target} style={{ ...tableGrid, fontSize: "var(--fs-13)", padding: "7px 0" }}>
                  <span>{r.target}</span>
                  <span style={{ textAlign: "right" }}>{r.runs}</span>
                  <span style={{ textAlign: "right" }}>{fmt(r.tokens)}</span>
                  <span style={{ textAlign: "right", color: r.limits > 0 ? "var(--limit)" : "var(--muted)" }}>
                    {r.limits}
                  </span>
                </div>
              ))}
            </div>

            <span style={{ fontSize: "var(--fs-12)", color: "var(--muted)", lineHeight: 1.5 }}>
              baris exhausted memberi countdown yang sama dengan pesan halted di Console — satu sumber
              kebenaran.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
