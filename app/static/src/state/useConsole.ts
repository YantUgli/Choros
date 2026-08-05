import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { consoleReducer, initialConsoleState, type ConsoleEvent } from "./consoleMachine";
import type { RunRequest } from "./types";
import { nowTs, type DaemonClient, type ScenarioId } from "../services/daemon";
import { createMockDaemon } from "../services/mockDaemon";
import { createSseDaemon } from "../services/sseDaemon";

/**
 * Menyatukan state machine dengan service daemon.
 *
 * Default: daemon NYATA lewat SSE ke /api/tasks (services/sseDaemon.ts).
 * Jalankan dengan `VITE_CHOROS_DAEMON=mock` untuk memakai skrip palsu — berguna
 * saat menggarap UI tanpa backend/kuota. Tidak ada komponen yang perlu tahu
 * bedanya: semuanya hanya membaca `state` dan memanggil aksi di bawah.
 */
export const USE_MOCK_DAEMON = import.meta.env.VITE_CHOROS_DAEMON === "mock";

export function useConsole() {
  const [state, dispatch] = useReducer(consoleReducer, {
    ...initialConsoleState,
    runId: USE_MOCK_DAEMON ? 38 : 0,
  });
  const [scenario, setScenario] = useState<ScenarioId>("cascade_tanya");
  const mockRunId = useRef(38);

  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const stateRef = useRef(state);
  stateRef.current = state;

  const daemonRef = useRef<DaemonClient | null>(null);
  if (daemonRef.current === null) {
    const sink = (e: ConsoleEvent) => dispatch(e);
    daemonRef.current = USE_MOCK_DAEMON
      ? createMockDaemon(sink, { getScenario: () => scenarioRef.current })
      : createSseDaemon(sink, { onTaskId: (id) => dispatch({ type: "RUN_ID", runId: id }) });
  }

  useEffect(() => () => daemonRef.current?.dispose(), []);

  const submit = useCallback((request: RunRequest) => {
    // Daemon nyata baru memberi id setelah tugas dibuat (event RUN_ID);
    // 0 berarti "belum diketahui" dan dirender sebagai "—".
    let runId = 0;
    if (USE_MOCK_DAEMON) {
      runId = mockRunId.current;
      mockRunId.current += 1;
    }
    dispatch({ type: "SUBMIT", request, runId, ts: nowTs() });
    daemonRef.current?.submit(request, runId);
  }, []);

  const rerun = useCallback((kind: "RESUME" | "RETRY") => {
    dispatch({ type: kind, ts: nowTs() });
    const req = stateRef.current.request;
    if (req) daemonRef.current?.submit(req, stateRef.current.runId);
  }, []);

  const attach = useCallback((taskId: number) => {
    // ATTACH memindahkan mesin dari idle → queued lebih dulu, kalau tidak semua
    // event stream yang di-replay akan diabaikan (idle hanya menerima SUBMIT).
    dispatch({ type: "ATTACH", runId: taskId, ts: nowTs() });
    daemonRef.current?.attach(taskId);
  }, []);

  const actions = useMemo(
    () => ({
      attach,
      submit,
      reply: (text: string) => daemonRef.current?.reply(text),
      followUp: (text: string) => daemonRef.current?.followUp(text),
      defer: () => daemonRef.current?.defer(),
      cancel: () => daemonRef.current?.cancel(),
      resume: () => rerun("RESUME"),
      retry: () => rerun("RETRY"),
      reset: () => dispatch({ type: "RESET" }),
      togglePause: () => dispatch({ type: "TOGGLE_PAUSE" }),
      clearStream: () => dispatch({ type: "CLEAR_STREAM" }),
      scrollAway: () => dispatch({ type: "SCROLL_AWAY" }),
      jumpLatest: () => dispatch({ type: "JUMP_LATEST" }),
    }),
    [attach, submit, rerun],
  );

  return { state, actions, scenario, setScenario, isMock: USE_MOCK_DAEMON };
}

export type ConsoleActions = ReturnType<typeof useConsole>["actions"];
