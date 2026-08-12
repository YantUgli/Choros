import { useEffect, useRef, useState } from "react";
import { useConsole } from "../../state/useConsole";
import { Badge, Button, Card, IconButton, MeterBar, Select, StatusDot } from "../../components/ds";
import { Label, Meta } from "../../components/Label";
import { useRegisterCommands, type Command } from "../../components/CommandPalette";
import { fetchAgents } from "../../services/agentApi";
import { StreamView } from "../console/StreamView";
import { ComposePanel } from "../console/ComposePanel";
import { CascadePanel } from "../console/CascadePanel";
import { FollowUpStrip } from "../console/FollowUpStrip";
import { Markdown } from "../../components/Markdown";
import { useModals } from "../../state/modals";
import { delegate, fanoutLane, fetchLaneTasks, type LaneTask } from "../../services/projectApi";
import { BUSY_STATUSES, TERMINAL_STATUSES, type TaskCategory } from "../../state/types";

/** Durasi ringkas dari milidetik: `m ss` atau `Xj Ym`. */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}j ${m % 60}m`;
  }
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

function dot(status: string) {
  if (status === "error") return "error" as const;
  if (status === "done") return "ok" as const;
  if (status === "halted") return "limit" as const;
  if (status === "idle") return "idle" as const;
  if (status === "waiting_for_input") return "warn" as const;
  return "running" as const;
}

export function ConsolePanel({
  runId,
  category,
  laneTaskId,
  folderPath,
  onDelegated,
  nextCategory,
  tokensAccumulated,
  fanoutAgent = null,
  onSelectWinner,
}: {
  runId: number;
  category: string;
  laneTaskId: number | null;
  folderPath: string;
  onDelegated: () => void;
  nextCategory: string | null;
  tokensAccumulated: number;
  /** Nama agent cabang ini bila panel bagian dari fan-out (Item C). */
  fanoutAgent?: string | null;
  /** Bila diisi, panel ini cabang fan-out → tampilkan aksi "pilih pemenang". */
  onSelectWinner?: () => void;
}) {
  const { state, actions } = useConsole();
  const modals = useModals();
  const [minimized, setMinimized] = useState(false);
  const [view, setView] = useState<"result" | "stream">("result");
  const [history, setHistory] = useState<LaneTask[]>([]);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [composePrompt, setComposePrompt] = useState("");
  const [tokenLimit, setTokenLimit] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Lane hasil delegasi dibuat di server → sambungkan stream tanpa submit.
  // Hanya untuk panel yang masih SEGAR (belum punya sesi sendiri): kalau panel ini
  // yang men-submit (lane 0), state.status sudah bukan idle → jangan attach lagi,
  // supaya refetch/poll tidak me-reset stream yang sedang berjalan.
  const attachedRef = useRef(false);
  useEffect(() => {
    if (laneTaskId !== null && !attachedRef.current && state.status === "idle" && !state.runId) {
      attachedRef.current = true;
      actions.attach(laneTaskId);
    }
  }, [laneTaskId, actions, state.status, state.runId]);

  const busy = BUSY_STATUSES.includes(state.status);
  const terminal = TERMINAL_STATUSES.includes(state.status);
  const currentTaskId = state.runId || laneTaskId;
  const showCompose = laneTaskId === null && state.status === "idle";
  const canDelegate = state.status === "done" && nextCategory !== null && !!currentTaskId;

  // Elapsed hidup: tick per detik hanya selama run berjalan (hemat saat idle/terminal).
  useEffect(() => {
    if (!busy || !state.startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy, state.startedAt]);

  // Batas token agent aktif (bahan meter) — dicocokkan dari route yang teresolusi.
  useEffect(() => {
    let active = true;
    fetchAgents()
      .then((ags) => {
        if (!active) return;
        const r = state.route;
        const m = ags.find(
          (a) => (a.default_model && r.includes(a.default_model)) || (a.name && r.includes(a.name)),
        );
        setTokenLimit(m?.token_limit ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [state.route]);

  // Sumber "elapsed": live saat berjalan; durasi final saat sudah selesai.
  const elapsedMs = busy && state.startedAt ? now - state.startedAt : null;
  const elapsedText = elapsedMs !== null ? fmtElapsed(elapsedMs) : state.result?.duration ?? null;
  const model = state.route && state.route !== "—" ? state.route : null;
  const showMeta = !showCompose && (model !== null || state.usage.total > 0 || state.startedAt !== null);

  // Muat riwayat hasil lane saat selesai → bahan picker.
  useEffect(() => {
    if (terminal && currentTaskId) {
      fetchLaneTasks(runId, category).then(setHistory).catch(() => {});
    }
  }, [terminal, currentTaskId, runId, category]);

  const picked = pickedId ? history.find((t) => t.id === pickedId) ?? null : null;
  const resultText = picked ? picked.finalOutput : state.result?.summary ?? null;

  const openDelegate = () => {
    if (!currentTaskId || !nextCategory) return;
    modals.openDelegate(currentTaskId, nextCategory, async (artifact: string) => {
      try {
        await delegate(currentTaskId, nextCategory, artifact);
        onDelegated();
      } catch (err) {
        modals.openConfirm({ title: "Gagal delegasi", body: String(err), onConfirm: () => {} });
      }
    });
  };

  // Mulai fan-out (Item C): lane ini di 2 agent serentak. 409 = kuota mentok → tawari force.
  const openFanout = () => {
    modals.openFanout(category, composePrompt, (agentIds, prompt, allowUnisolated) => {
      const run = (force: boolean) =>
        fanoutLane(runId, category, prompt, agentIds, { allowUnisolated, force }).then(onDelegated);
      run(false).catch((err: any) => {
        if (err?.status === 409) {
          modals.openConfirm({
            title: "Kuota mentok",
            body: "Agent terpilih kuotanya mentok. Fan-out membakar kuota 2×. Tetap lanjut?",
            onConfirm: () => { run(true).catch(() => {}); },
          });
        } else {
          modals.openConfirm({ title: "Gagal fan-out", body: String(err?.message ?? err), onConfirm: () => {} });
        }
      });
    });
  };

  // Perintah lane untuk command palette (⌘K) — didaftar ulang saat state relevan berubah.
  const laneCommands: Command[] = [
    {
      id: `lane:${runId}:${category}:min`,
      group: "Lane",
      label: minimized ? `Buka lane ${category}` : `Ciutkan lane ${category}`,
      run: () => setMinimized((m) => !m),
    },
  ];
  if (!showCompose) {
    laneCommands.push({
      id: `lane:${runId}:${category}:view`,
      group: "Lane",
      label: `Lane ${category}: tampilkan ${view === "result" ? "stream" : "hasil"}`,
      run: () => setView((v) => (v === "result" ? "stream" : "result")),
    });
  }
  if (showCompose) {
    laneCommands.push({
      id: `lane:${runId}:${category}:fanout`,
      group: "Lane",
      label: `Fan-out lane ${category} (2 agent)`,
      run: openFanout,
    });
  }
  if (canDelegate && nextCategory && !onSelectWinner) {
    laneCommands.push({
      id: `lane:${runId}:${category}:delegate`,
      group: "Lane",
      label: `Delegasikan ${category} → ${nextCategory}`,
      run: openDelegate,
    });
  }
  if (onSelectWinner) {
    laneCommands.push({
      id: `lane:${runId}:${category}:winner:${laneTaskId}`,
      group: "Lane",
      label: `Pilih pemenang: ${category}${fanoutAgent ? ` (${fanoutAgent})` : ""}`,
      run: onSelectWinner,
    });
  }
  useRegisterCommands(laneCommands, [runId, category, minimized, view, showCompose, canDelegate, nextCategory, !!onSelectWinner, laneTaskId, fanoutAgent]);

  // ── Minimized: chip status + token (run + akumulasi) + ringkas hasil ──
  if (minimized) {
    return (
      <Card interactive onClick={() => setMinimized(false)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
        <StatusDot status={dot(state.status)} pulse={busy} />
        <Badge tone="brand" mono>{category}</Badge>
        {fanoutAgent && <Badge tone="neutral" mono>{fanoutAgent}</Badge>}
        <Meta style={{ whiteSpace: "nowrap" }}>
          {state.usage.total.toLocaleString()} tok · Σ {tokensAccumulated.toLocaleString()}
          {elapsedText ? ` · ⏱ ${elapsedText}` : ""}
        </Meta>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-13)", color: "var(--muted)" }}>
          {state.result?.summary?.split("\n")[0] || (busy ? "berjalan…" : "—")}
        </span>
        <IconButton title="Buka" onClick={(e) => { e.stopPropagation(); setMinimized(false); }}>▢</IconButton>
      </Card>
    );
  }

  return (
    <Card style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 0, minHeight: 0 }}>
      {/* Header — status + kategori + Active route + kontrol */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--line)", background: "var(--panel-2)", flex: "none" }}>
        <StatusDot status={dot(state.status)} pulse={busy} />
        <Badge tone="brand" mono>{category}</Badge>
        {fanoutAgent && <Badge tone="neutral" mono>{fanoutAgent}</Badge>}
        <Meta style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.status}{state.route && state.route !== "—" ? ` · → ${state.route}` : ""}
        </Meta>
        {!showCompose && (
          <Button variant="ghost" size="sm" onClick={() => setView((v) => (v === "result" ? "stream" : "result"))}>
            {view === "result" ? "Stream" : "Hasil"}
          </Button>
        )}
        {showCompose && (
          <Button variant="ghost" size="sm" onClick={openFanout} title="Jalankan lane ini di 2 agent serentak">
            Fan-out
          </Button>
        )}
        {busy && <Button variant="danger" size="sm" onClick={actions.cancel}>Batal</Button>}
        <IconButton title="Ciutkan" onClick={() => setMinimized(true)}>—</IconButton>
      </div>

      {/* Metrik lane — elapsed hidup + meter token (sumber jujur, bukan progress %) */}
      {showMeta && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-1) var(--space-3) var(--space-2)",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel-2)",
            flex: "none",
          }}
        >
          {elapsedText && <Meta style={{ whiteSpace: "nowrap" }}>⏱ {elapsedText}</Meta>}
          <div style={{ flex: 1, minWidth: 0 }}>
            {tokenLimit ? (
              <MeterBar value={state.usage.total} max={tokenLimit} unit="tok" height={5} />
            ) : (
              <Meta>{state.usage.total.toLocaleString()} tok</Meta>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {showCompose ? (
          <ComposePanel
            title="Prompt"
            wide
            lockedCategory
            fixedProjectPath={folderPath}
            taskRunId={runId}
            busy={busy}
            canCancel={busy}
            prompt={composePrompt}
            setPrompt={setComposePrompt}
            category={category as TaskCategory}
            setCategory={() => {}}
            onRun={actions.submit}
            onCancel={actions.cancel}
          />
        ) : view === "stream" || !resultText ? (
          <StreamView
            state={state}
            onReply={actions.reply}
            onDefer={actions.defer}
            onScrollAway={actions.scrollAway}
            onJumpLatest={actions.jumpLatest}
          />
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {history.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--line)" }}>
                <Label strong={false}>Hasil</Label>
                <Select
                  size="sm"
                  value={pickedId ?? "live"}
                  onChange={(e) => setPickedId(e.target.value === "live" ? null : Number(e.target.value))}
                >
                  <option value="live">terakhir (#{currentTaskId})</option>
                  {history.filter((t) => t.id !== currentTaskId).map((t) => (
                    <option key={t.id} value={t.id}>#{t.id} · {t.status}</option>
                  ))}
                </Select>
              </div>
            )}
            <div style={{ flex: 1, overflow: "auto", padding: "var(--space-3) var(--space-4)" }}>
              <Markdown text={resultText ?? ""} />
            </div>
          </div>
        )}
      </div>

      {/* Cascade / fallback — ciri khas: kisah CC→AG→OC */}
      {state.attempts.length > 0 && currentTaskId && (
        <CascadePanel runId={currentTaskId} attempts={state.attempts} status={state.status} />
      )}

      {/* Follow-up — refine di lane yang sama sebelum delegasi */}
      {terminal && <FollowUpStrip onSend={actions.followUp} />}

      {/* Fan-out (Item C): pilih cabang ini sebagai pemenang → cabang lain dibuang.
          Delegasi per-cabang disembunyikan; delegasi dilakukan setelah pemenang dipilih. */}
      {onSelectWinner ? (
        <div style={{ padding: "var(--space-2) var(--space-3)", borderTop: "1px solid var(--line)", flex: "none", display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" onClick={onSelectWinner}>Pilih sebagai pemenang ✓</Button>
        </div>
      ) : (
        /* Delegasi — aksi eksplisit ke lane berikutnya */
        canDelegate && (
          <div style={{ padding: "var(--space-2) var(--space-3)", borderTop: "1px solid var(--line)", flex: "none", display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" size="sm" onClick={openDelegate}>Delegasikan ke {nextCategory} →</Button>
          </div>
        )
      )}
    </Card>
  );
}
