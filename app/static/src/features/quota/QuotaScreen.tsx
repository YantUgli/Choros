import { useEffect, useState } from "react";
import { Badge, Button, KeyValue, Panel } from "../../components/ds";
import { Label } from "../../components/Label";
import { fetchQuota, formatCooldown, resetQuota } from "../../services/quotaApi";
import { useApiResource } from "../../state/useApiResource";

const fmt = (n: number) => n.toLocaleString("en-US");

const windowGrid = {
  display: "grid",
  gridTemplateColumns: "260px 1fr 190px",
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
  const [res, reload] = useApiResource(fetchQuota);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
      // Satu cooldown baru saja habis -> minta data segar. Memutuskan ini di
      // badan render (versi lama) adalah efek samping saat render, dan
      // terpanggil dua kali di React StrictMode.
      if (
        res.phase === "ready" &&
        res.data.rows.some(
          (q) => q.cooldownEnd !== null && Date.parse(q.cooldownEnd) <= Date.now(),
        )
      ) {
        reload();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [res, reload]);

  if (res.phase === "loading") {
    return <div style={{ padding: "var(--space-4)" }}>Memuat...</div>;
  }
  if (res.phase === "error") {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--limit)" }}>
        {res.status === 401 ? "belum login" : `daemon tidak menjawab: ${res.message}`}
        <br />
        <Button onClick={reload} style={{ marginTop: 10 }}>Coba lagi</Button>
      </div>
    );
  }

  const { rows, consumption } = res.data;
  const nowMs = Date.now();

  const cooldowns = rows
    .filter((q) => q.cooldownEnd !== null)
    .map((q) => {
      const left = Math.max(0, Math.round((Date.parse(q.cooldownEnd!) - nowMs) / 1000));
      return { ...q, left };
    });

  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 960, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Panel title="Quota" subtitle="tercatat lewat choros — bukan sisa kuota resmi provider">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Label style={{ marginBottom: 6 }}>Window aktif — per (agent, model)</Label>

              {rows.length === 0 ? (
                <div style={{ fontSize: "var(--fs-13)", color: "var(--muted)", fontStyle: "italic", padding: "10px 0" }}>
                  belum ada konsumsi tercatat
                </div>
              ) : (
                rows.map((q) => {
                  let windowText = "—";
                  if (q.windowType && q.windowEnd) {
                    const date = new Date(q.windowEnd);
                    windowText = `${q.windowType} · berakhir ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
                  }
                  
                  return (
                    <div key={q.key} style={windowGrid}>
                      <span>
                        {q.agent} / {q.model}
                      </span>
                      <span style={{ color: "var(--muted)" }}>
                        {windowText}
                      </span>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--muted)" }}>
                          {fmt(q.used)} tok
                        </span>
                        <Badge tone={q.exhausted ? "limit" : "neutral"}>
                          {q.exhausted ? "limit" : "tersedia"}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}

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
                  <div key={q.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <KeyValue
                      label={`${q.agent} / ${q.model}`}
                      value={`reset dalam ${formatCooldown(q.left)}`}
                      valueColor="var(--limit)"
                      labelWidth={260}
                    />
                    <Button
                      onClick={async () => {
                        await resetQuota(q.agentId, q.model);
                        reload();
                      }}
                      title="saya yakin kuotanya sudah pulih"
                    >
                      Reset
                    </Button>
                  </div>
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
              {consumption.map((r) => (
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
              baris exhausted memberi countdown yang sama dengan pesan halted di Console — satu sumber kebenaran.
              <br />
              tidak ada angka 'sisa kuota': langganan tidak mengekspornya, jadi yang ditampilkan hanya yang benar-benar tercatat choros.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
