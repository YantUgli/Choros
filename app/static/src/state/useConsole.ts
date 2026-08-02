import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { consoleReducer, initialConsoleState, type ConsoleEvent } from "./consoleMachine";
import type { RunRequest } from "./types";
import { nowTs, type DaemonClient, type ScenarioId } from "../services/daemon";
import { createMockDaemon } from "../services/mockDaemon";

/**
 * Menyatukan state machine dengan service daemon.
 *
 * Untuk pindah ke stream nyata: ganti `createMockDaemon(dispatchRef…)` dengan
 * `createSseDaemon(…)` dari services/sseDaemon.ts. Tidak ada komponen UI yang
 * perlu berubah — semuanya hanya membaca `state` dan memanggil aksi di bawah.
 */
export function useConsole() {
  const [state, dispatch] = useReducer(consoleReducer, initialConsoleState);
  const [scenario, setScenario] = useState<ScenarioId>("cascade_tanya");
  const nextRunId = useRef(38);

  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;

  const stateRef = useRef(state);
  stateRef.current = state;

  const daemonRef = useRef<DaemonClient | null>(null);
  if (daemonRef.current === null) {
    daemonRef.current = createMockDaemon(
      (e: ConsoleEvent) => dispatch(e),
      { getScenario: () => scenarioRef.current },
    );
  }

  useEffect(() => () => daemonRef.current?.dispose(), []);

  const submit = useCallback((request: RunRequest) => {
    const runId = nextRunId.current;
    nextRunId.current += 1;
    dispatch({ type: "SUBMIT", request, runId, ts: nowTs() });
    daemonRef.current?.submit(request, runId);
  }, []);

  const actions = useMemo(
    () => ({
      submit,
      reply: (text: string) => daemonRef.current?.reply(text),
      defer: () => daemonRef.current?.defer(),
      cancel: () => daemonRef.current?.cancel(),
      resume: () => {
        dispatch({ type: "RESUME", ts: nowTs() });
        const req = stateRef.current.request;
        if (req) daemonRef.current?.submit(req, stateRef.current.runId);
      },
      retry: () => {
        dispatch({ type: "RETRY", ts: nowTs() });
        const req = stateRef.current.request;
        if (req) daemonRef.current?.submit(req, stateRef.current.runId);
      },
      reset: () => dispatch({ type: "RESET" }),
      togglePause: () => dispatch({ type: "TOGGLE_PAUSE" }),
      clearStream: () => dispatch({ type: "CLEAR_STREAM" }),
      scrollAway: () => dispatch({ type: "SCROLL_AWAY" }),
      jumpLatest: () => dispatch({ type: "JUMP_LATEST" }),
    }),
    [submit],
  );

  return { state, actions, scenario, setScenario };
}

export type ConsoleActions = ReturnType<typeof useConsole>["actions"];
