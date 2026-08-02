import { useEffect, useState } from "react";
import { Badge, Button, Select, StatusDot, type BadgeTone, type DotStatus } from "../../components/ds";
import { Meta } from "../../components/Label";
import { SESSIONS } from "../../data/fixtures";
import { SCENARIOS, type ScenarioId } from "../../services/daemon";
import { useModals } from "../../state/modals";
import {
  BUSY_STATUSES,
  CANCELLABLE_STATUSES,
  type ConsoleState,
  type ConsoleStatus,
} from "../../state/types";
import type { ConsoleActions } from "../../state/useConsole";
import { CascadePanel } from "./CascadePanel";
import { ComposePanel } from "./ComposePanel";
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

  const pill = PILLS[state.status];
  const busy = BUSY_STATUSES.includes(state.status);
  const canCancel = CANCELLABLE_STATUSES.includes(state.status);
  const session = SESSIONS.find((s) => s.id === selectedSession) ?? null;
  const live = session === null;
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

  // Panel cascade hanya muncul kalau cascade benar-benar terjadi — run yang lurus
  // dari target pertama tidak perlu diceritakan.
  const showCascade = state.attempts.some((a) => a.outcome === "failed" || a.outcome === "skipped");
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
              <StatusDot status={session.dot} />
              <span
                style={{
                  fontSize: "var(--fs-13)",
                  fontWeight: 600,
                  letterSpacing: "var(--tracking-label)",
                  whiteSpace: "nowrap",
                }}
              >
                Riwayat sesi #{session.id}
              </span>
              <Meta
                style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {session.category} · {session.mode}
              </Meta>
              <div style={{ marginLeft: "auto", flex: "none" }}>
                <Button variant="ghost" size="sm" onClick={() => setSelectedSession(null)}>
                  ← kembali ke run aktif
                </Button>
              </div>
            </>
          )}
        </div>

        {session ? (
          <TranscriptView session={session} />
        ) : (
          <>
            <StreamView
              state={state}
              onReply={actions.reply}
              onDefer={actions.defer}
              onScrollAway={actions.scrollAway}
              onJumpLatest={actions.jumpLatest}
            />

            {showCascade && (
              <CascadePanel runId={state.runId} attempts={state.attempts} status={state.status} />
            )}

            {state.status === "done" && state.result && (
              <ResultStrip
                result={state.result}
                onDiff={() => modals.openDiff(state.runId, actions.reset)}
                onMerge={actions.reset}
                onDiscard={actions.reset}
              />
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
