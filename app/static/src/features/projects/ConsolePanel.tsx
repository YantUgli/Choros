import { useEffect, useRef, useState } from "react";
import { useConsole } from "../../state/useConsole";
import { Badge, Button, Card, IconButton, Select, StatusDot } from "../../components/ds";
import { Label, Meta } from "../../components/Label";
import { StreamView } from "../console/StreamView";
import { ComposePanel } from "../console/ComposePanel";
import { CascadePanel } from "../console/CascadePanel";
import { FollowUpStrip } from "../console/FollowUpStrip";
import { Markdown } from "../../components/Markdown";
import { useModals } from "../../state/modals";
import { delegate, fetchLaneTasks, type LaneTask } from "../../services/projectApi";
import { BUSY_STATUSES, TERMINAL_STATUSES, type TaskCategory } from "../../state/types";

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
}: {
  runId: number;
  category: string;
  laneTaskId: number | null;
  folderPath: string;
  onDelegated: () => void;
  nextCategory: string | null;
  tokensAccumulated: number;
}) {
  const { state, actions } = useConsole();
  const modals = useModals();
  const [minimized, setMinimized] = useState(false);
  const [view, setView] = useState<"result" | "stream">("result");
  const [history, setHistory] = useState<LaneTask[]>([]);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [composePrompt, setComposePrompt] = useState("");

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

  // ── Minimized: chip status + token (run + akumulasi) + ringkas hasil ──
  if (minimized) {
    return (
      <Card interactive onClick={() => setMinimized(false)} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)" }}>
        <StatusDot status={dot(state.status)} pulse={busy} />
        <Badge tone="brand" mono>{category}</Badge>
        <Meta style={{ whiteSpace: "nowrap" }}>
          {state.usage.total.toLocaleString()} tok · Σ {tokensAccumulated.toLocaleString()}
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
        <Meta style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state.status}{state.route && state.route !== "—" ? ` · → ${state.route}` : ""}
        </Meta>
        {!showCompose && (
          <Button variant="ghost" size="sm" onClick={() => setView((v) => (v === "result" ? "stream" : "result"))}>
            {view === "result" ? "Stream" : "Hasil"}
          </Button>
        )}
        {busy && <Button variant="danger" size="sm" onClick={actions.cancel}>Batal</Button>}
        <IconButton title="Ciutkan" onClick={() => setMinimized(true)}>—</IconButton>
      </div>

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

      {/* Delegasi — aksi eksplisit ke lane berikutnya */}
      {canDelegate && (
        <div style={{ padding: "var(--space-2) var(--space-3)", borderTop: "1px solid var(--line)", flex: "none", display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" onClick={openDelegate}>Delegasikan ke {nextCategory} →</Button>
        </div>
      )}
    </Card>
  );
}
