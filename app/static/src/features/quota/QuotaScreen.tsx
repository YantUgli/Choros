import { useEffect, useState } from "react";
import { Button, KeyValue, MeterBar, Panel } from "../../components/ds";
import { Label } from "../../components/Label";
import { fetchClaudeUsage, type ClaudeUsage } from "../../services/claudeUsageApi";
import { fetchGeminiUsage, type GeminiUsage } from "../../services/geminiUsageApi";
import { fetchQuota, formatCooldown, resetQuota } from "../../services/quotaApi";
import { useApiResource } from "../../state/useApiResource";

const fmt = (n: number) => n.toLocaleString("en-US");

const sectionLabel: React.CSSProperties = {
  fontSize: "var(--fs-12)",
  fontFamily: "var(--font-mono)",
  letterSpacing: "var(--tracking-label)",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 8,
};

const divider: React.CSSProperties = {
  borderTop: "1px solid var(--line)",
  paddingTop: "var(--space-4)",
  marginTop: "var(--space-2)",
};

const tableGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 90px 140px 110px",
  fontFamily: "var(--font-mono)",
  borderTop: "1px solid var(--line)",
};

// ── Claude Code Section ────────────────────────────────────────────────────────

function ClaudeSection({ data }: { data: ClaudeUsage | null }) {
  if (!data) {
    return <div style={{ color: "var(--muted)", fontSize: "var(--fs-13)" }}>Memuat...</div>;
  }

  if (data.error) {
    const msgs: Record<string, string> = {
      claude_not_found: "binary 'claude' tidak ditemukan di PATH",
      timeout: "subprocess timeout (> 10 detik)",
    };
    return (
      <div style={{ color: "var(--warn)", fontSize: "var(--fs-13)" }}>
        {msgs[data.error] ?? `error: ${data.error}`}
      </div>
    );
  }

  const periods = [
    { key: "session", label: "Current Session", d: data.session },
    { key: "week", label: "Current Week", d: data.week },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {periods.map(({ key, label, d }) =>
        d ? (
          <div key={key}>
            <MeterBar value={d.pct_used} max={100} label={label} unit="%" />
            <div style={{ fontSize: "var(--fs-12)", color: "var(--muted)", marginTop: 2 }}>
              resets {d.resets_at}
            </div>
          </div>
        ) : null,
      )}
      {!data.session && !data.week && (
        <div style={{ color: "var(--muted)", fontSize: "var(--fs-13)" }}>
          tidak ada data usage tersedia
        </div>
      )}
    </div>
  );
}

// ── Gemini Section ─────────────────────────────────────────────────────────────

const GEMINI_ERROR_MSG: Record<string, string> = {
  token_not_found: "token agy tidak ditemukan di keyring — buka agy sekali",
  token_expired: "token expired — buka agy sekali untuk memperbarui",
  keyring_unavailable: "GNOME keyring tidak tersedia (Linux only)",
  api_error: "gagal menghubungi Gemini API",
};

function GeminiSection({ data }: { data: GeminiUsage | null }) {
  if (!data) {
    return <div style={{ color: "var(--muted)", fontSize: "var(--fs-13)" }}>Memuat...</div>;
  }

  if (data.error) {
    return (
      <div
        style={{
          color: data.error === "token_expired" || data.error === "token_not_found"
            ? "var(--warn)"
            : "var(--limit)",
          fontSize: "var(--fs-13)",
        }}
      >
        ⚠ {GEMINI_ERROR_MSG[data.error] ?? `error: ${data.error}`}
      </div>
    );
  }

  const groups = data.groups ?? [];
  if (groups.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: "var(--fs-13)" }}>tidak ada data quota</div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.display_name && (
            <div
              style={{
                fontSize: "var(--fs-13)",
                fontFamily: "var(--font-mono)",
                color: "var(--fg)",
                marginBottom: 6,
              }}
            >
              {g.display_name}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {g.buckets.map((b) => (
              <div key={b.bucket_id}>
                <MeterBar value={b.pct_used} max={100} label={b.display_name} unit="%" />
                <div style={{ fontSize: "var(--fs-12)", color: "var(--muted)", marginTop: 2 }}>
                  resets {new Date(b.resets_at).toLocaleString("id-ID", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── QuotaScreen ────────────────────────────────────────────────────────────────

export function QuotaScreen() {
  const [res, reload] = useApiResource(fetchQuota);
  const [, tick] = useState(0);

  const [claudeData, setClaudeData] = useState<ClaudeUsage | null>(null);
  const [geminiData, setGeminiData] = useState<GeminiUsage | null>(null);

  // Initial fetch + 60-second polling untuk Claude dan Gemini.
  // Tidak pakai ref gate — cukup `cancelled` untuk handle StrictMode double-mount.
  useEffect(() => {
    let cancelled = false;
    const loadClaude = () =>
      fetchClaudeUsage().then((d) => { if (!cancelled) setClaudeData(d); }).catch(() => {});
    const loadGemini = () =>
      fetchGeminiUsage().then((d) => { if (!cancelled) setGeminiData(d); }).catch(() => {});

    loadClaude();
    loadGemini();
    const id = setInterval(() => { loadClaude(); loadGemini(); }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 1-second tick for cooldown countdown + auto-reload when cooldown expires
  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
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

  const opencodeRows = rows.filter((q) => q.adapterType === "opencode");
  const cooldowns = rows
    .filter((q) => q.cooldownEnd !== null)
    .map((q) => {
      const left = Math.max(0, Math.round((Date.parse(q.cooldownEnd!) - nowMs) / 1000));
      return { ...q, left };
    });

  return (
    <div className="ov" style={{ flex: 1, minWidth: 0, padding: "var(--space-4)", overflow: "auto" }}>
      <div style={{ maxWidth: 960, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Panel title="Quota" subtitle="Claude Code dan Gemini: data resmi dari provider · OpenCode: tercatat via choros">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            {/* ── Claude Code ──────────────────────────────────────────── */}
            <div>
              <Label style={sectionLabel}>Claude Code</Label>
              <ClaudeSection data={claudeData} />
            </div>

            {/* ── Gemini (anti-gravity) ─────────────────────────────── */}
            <div style={divider}>
              <Label style={{ ...sectionLabel, marginBottom: 8 }}>Gemini (anti-gravity)</Label>
              <GeminiSection data={geminiData} />
            </div>

            {/* ── OpenCode ─────────────────────────────────────────── */}
            <div style={divider}>
              <Label style={sectionLabel}>OpenCode</Label>
              {opencodeRows.length === 0 ? (
                <div style={{ fontSize: "var(--fs-13)", color: "var(--muted)", fontStyle: "italic" }}>
                  belum ada konsumsi tercatat
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  {opencodeRows.map((q) => {
                    let windowText = "—";
                    if (q.windowType && q.windowEnd) {
                      const date = new Date(q.windowEnd);
                      windowText = `${q.windowType} · berakhir ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
                    }

                    const showMeter = q.tokenLimit != null;
                    const alertActive = q.exhausted && q.tokenLimit != null;

                    return (
                      <div
                        key={q.key}
                        style={{
                          borderTop: "1px solid var(--line)",
                          paddingTop: "var(--space-2)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-13)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: showMeter ? 4 : 0 }}>
                          <span>{q.agent} / {q.model ?? "—"}</span>
                          <span style={{ color: "var(--muted)" }}>{fmt(q.used)} tok</span>
                        </div>
                        {showMeter && (
                          <MeterBar
                            value={q.used}
                            max={q.tokenLimit!}
                            unit="tok"
                            tone={alertActive ? "limit" : undefined}
                          />
                        )}
                        <div style={{ color: "var(--muted)", fontSize: "var(--fs-12)", marginTop: 2 }}>
                          {windowText}
                        </div>
                        {alertActive && (
                          <div
                            style={{
                              marginTop: 4,
                              color: "var(--limit)",
                              fontSize: "var(--fs-12)",
                            }}
                          >
                            ! {fmt(q.used)} / {fmt(q.tokenLimit!)} tok — limit tercapai
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Cooldown aktif ───────────────────────────────────── */}
            <div style={divider}>
              <Label style={{ ...sectionLabel, marginBottom: 6 }}>Cooldown aktif</Label>
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

            {/* ── Konsumsi 7 hari ─────────────────────────────────── */}
            <div style={divider}>
              <Label style={{ ...sectionLabel, marginBottom: 6 }}>Konsumsi 7 hari</Label>
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
              Claude Code / Gemini: data langsung dari provider — akurasi resmi.
              <br />
              OpenCode: konsumsi tercatat choros + status 429 — bukan sisa kuota resmi.
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
