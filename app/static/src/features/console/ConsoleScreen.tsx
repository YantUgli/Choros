import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Select, StatusDot, type BadgeTone, type DotStatus } from "../../components/ds";
import { Meta } from "../../components/Label";
import { SCENARIOS, type ScenarioId } from "../../services/daemon";
import { useModals } from "../../state/modals";
import {
  BUSY_STATUSES,
  CANCELLABLE_STATUSES,
  type ConsoleState,
  type ConsoleStatus,
} from "../../state/types";
import type { ConsoleActions } from "../../state/useConsole";
import { AttemptsPanel } from "./AttemptsPanel";
import { CascadePanel } from "./CascadePanel";
import { ComposePanel } from "./ComposePanel";
import { FollowUpStrip } from "./FollowUpStrip";
import { HistoryList } from "./HistoryList";
import { ErrorStrip, HaltedStrip, ResultStrip } from "./ResultStrips";
import { StreamView } from "./StreamView";
import { TranscriptView } from "./TranscriptView";

/** pill state: [tone Badge, label, status StatusDot] — satu sumber untuk seluruh Console. */
const PILLS: Record<ConsoleStatus, [BadgeTone, string, DotStatus]> = {
  idle: ["neutral", "idle", "idle"],
  queued: ["neutral", "queued", "idle"],
  running: ["brand", "running", "running"],
  waiting_for_input: ["warn", "waiting_for_input", "warn"],
  cascading: ["limit", "cascading", "limit"],
  done: ["ok", "✓ done", "ok"],
  halted: ["neutral", "halted", "idle"],
  error: ["error", "✗ error", "error"],
};

export function ConsoleScreen({
  state,
  actions,
  scenario,
  setScenario,
  isMock,
  onOpenQuota,
}: {
  state: ConsoleState;
  actions: ConsoleActions;
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  /** true = mock daemon; selector skenario hanya muncul di mode ini. */
  isMock: boolean;
  onOpenQuota: () => void;
}) {
  const modals = useModals();
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [attemptsFailed, setAttemptsFailed] = useState(false);

  // Run baru berhak atas percobaan pengambilan jejaknya sendiri.
  useEffect(() => {
    setAttemptsFailed(false);
  }, [state.runId]);

  // Identitasnya harus stabil: AttemptsPanel menaruhnya di dependency effect,
  // jadi callback baru tiap render = satu GET /logs tiap render induk.
  const onAttemptsEmpty = useCallback(() => setAttemptsFailed(true), []);

  const pill = PILLS[state.status];
  const busy = BUSY_STATUSES.includes(state.status);
  const canCancel = CANCELLABLE_STATUSES.includes(state.status);
  const live = selectedSession === null;
  const category = state.request?.category ?? "coding_complex";

  // ⌘↵ / Ctrl↵ dari mana pun di layar Console: submit ditangani ComposePanel;
  // Esc mengembalikan fokus ke stream (melepas kunci fokus balasan).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const terminal = state.status === "done" || state.status === "halted" || state.status === "error";
  // Panel cascade hanya muncul kalau cascade benar-benar terjadi — run yang lurus
  // dari target pertama tidak perlu diceritakan.
  const showCascade = state.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");
  // Jejak eksekusi menggantikan panel cascade begitu run berhenti — tapi kalau
  // jejaknya gagal diambil, cascade kembali jadi cadangan agar layar tak kosong.
  const showAttempts = terminal && state.runId > 0 && !isMock && !attemptsFailed;
  const showPlainFooter = state.status === "running" || state.status === "cascading" || state.paused;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
      <div
        className="ov"
        style={{
          width: 340,
          flex: "none",
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <ComposePanel
          busy={busy}
          canCancel={canCancel}
          onRun={(request) => {
            setSelectedSession(null);
            actions.submit(request);
          }}
          onCancel={actions.cancel}
        />
        <HistoryList
          selected={selectedSession}
          onSelect={setSelectedSession}
          liveRunId={state.runId}
          liveCategory={category}
          liveLabel={pill[1]}
          liveDot={pill[2]}
          isTerminal={terminal}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <div
          style={{
            height: 40,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "0 var(--space-4)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {live ? (
            <>
              <StatusDot status={pill[2]} />
              <span
                style={{
                  fontSize: "var(--fs-13)",
                  fontWeight: 600,
                  letterSpacing: "var(--tracking-label)",
                  whiteSpace: "nowrap",
                }}
              >
                Live console
              </span>
              <Meta
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                run #{state.runId || "—"} · {category} · {state.route}
              </Meta>
              <Badge tone={pill[0]}>{pill[1]}</Badge>
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  flex: "none",
                }}
              >
                {isMock && (
                  <label
                    style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}
                    title="skrip yang diputar mock daemon untuk run berikutnya"
                  >
                    <Meta>mock</Meta>
                    <Select
                      size="sm"
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value as ScenarioId)}
                      aria-label="skenario mock daemon"
                    >
                      {SCENARIOS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                )}
                <Button variant="ghost" size="sm" onClick={actions.togglePause}>
                  {state.paused ? "resume" : "pause"}
                </Button>
                <Button variant="ghost" size="sm" onClick={actions.clearStream}>
                  bersihkan
                </Button>
                <Button variant="ghost" size="sm" onClick={actions.jumpLatest}>
                  ↓ jump
                </Button>
              </div>
            </>
          ) : (
            <>
              <StatusDot status="idle" />
              <span
                style={{
                  fontSize: "var(--fs-13)",
                  fontWeight: 600,
                  letterSpacing: "var(--tracking-label)",
                  whiteSpace: "nowrap",
                }}
              >
                Riwayat sesi #{selectedSession}
              </span>
              <div style={{ marginLeft: "auto", flex: "none" }}>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSession(null)}>
                  ← kembali ke run aktif
                </Button>
              </div>
            </>
          )}
        </div>

        {selectedSession !== null ? (
          <TranscriptView taskId={selectedSession} />
        ) : (
          <>
            <StreamView
              state={state}
              onReply={actions.reply}
              onDefer={actions.defer}
              onScrollAway={actions.scrollAway}
              onJumpLatest={actions.jumpLatest}
            />

            {showAttempts && <AttemptsPanel taskId={state.runId} onEmpty={onAttemptsEmpty} />}
            {showCascade && !showAttempts && (
              <CascadePanel runId={state.runId} attempts={state.attempts} status={state.status} />
            )}

            {state.status === "done" && state.result && (
              <>
                <ResultStrip
                  result={state.result}
                  onDiff={() => modals.openDiff(state.runId, actions.reset)}
                  onMerge={async () => {
                    const { mergeDiff } = await import("../../services/taskApi");
                    try {
                      await mergeDiff(state.runId);
                      actions.reset();
                    } catch (err) {
                      alert(`Gagal merge: ${String(err)}`);
                    }
                  }}
                  onDiscard={async () => {
                    if (!window.confirm("Buang semua perubahan di worktree ini?")) return;
                    const { discardDiff } = await import("../../services/taskApi");
                    try {
                      await discardDiff(state.runId);
                      actions.reset();
                    } catch (err) {
                      alert(`Gagal discard: ${String(err)}`);
                    }
                  }}
                />
                <FollowUpStrip onSend={actions.followUp} />
              </>
            )}

            {state.status === "halted" && state.halt && (
              <HaltedStrip
                halt={state.halt}
                category={category}
                onResume={actions.resume}
                onQuota={onOpenQuota}
              />
            )}

            {state.status === "error" && state.failure && (
              <ErrorStrip
                failure={state.failure}
                onRetry={actions.retry}
                onCopy={() => {
                  void navigator.clipboard?.writeText(
                    state.stream.map((e) => `${e.ts} ${e.source} ${e.text}`).join("\n"),
                  );
                }}
              />
            )}

            {showPlainFooter && (
              <div
                style={{
                  flex: "none",
                  borderTop: "1px solid var(--line)",
                  padding: "var(--space-2) var(--space-4)",
                }}
              >
                <Meta>
                  {state.paused
                    ? "stream dijeda (tampilan) — event tetap direkam"
                    : "auto-scroll aktif · hasil & worktree review muncul saat done"}
                </Meta>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
