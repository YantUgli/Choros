/**
 * State machine Console — satu run tugas.
 *
 *   idle → queued → running → waiting_for_input → cascading → (done | halted | error)
 *
 * Transisi ditulis eksplisit di TRANSITIONS. Reducer tidak pernah menebak:
 * event yang tidak punya transisi sah untuk status sekarang diabaikan
 * (`transition()` mengembalikan null) — sehingga event daemon yang datang
 * terlambat tidak bisa membangunkan run yang sudah selesai.
 */

import {
  CANCELLABLE_STATUSES,
  type CascadeAttempt,
  type ConsoleState,
  type ConsoleStatus,
  type FailureInfo,
  type HaltInfo,
  type RunRequest,
  type RunResult,
  type StreamEvent,
  type Usage,
} from "./types";

export type ConsoleEvent =
  /** user menekan Jalankan (⌘↵) */
  | { type: "SUBMIT"; request: RunRequest; runId: number; ts: string }
  /** daemon memberi slot; run mulai dieksekusi di `target` */
  | { type: "SLOT_FREE"; target: string; ts: string }
  /** satu baris stream biasa (thinking / tool_call / file_edit / output / info) */
  | { type: "LOG"; event: StreamEvent }
  /**
   * Potongan output yang menetes (adapter mengirim `partial`). Digabung ke baris
   * berjalan yang sama supaya console terasa seperti terminal, bukan banjir baris.
   */
  | { type: "LOG_DELTA"; streamId: string; ts: string; source: string; text: string }
  /** usage menetes per event */
  | { type: "USAGE"; usage: Usage; event: StreamEvent }
  /** agent bertanya (mode interaktif) */
  | { type: "QUESTION"; event: StreamEvent }
  /** user menjawab pertanyaan */
  | { type: "REPLY"; text: string; ts: string }
  /** user menyerahkan keputusan ke agent */
  | { type: "DEFER"; ts: string }
  /** target gagal: 429/limit, < quality_floor, atau error yang masih bisa dipulihkan */
  | { type: "TARGET_FAILED"; attempt: CascadeAttempt; event: StreamEvent }
  /** target berikutnya ditemukan → eksekusi lanjut, plan di-reuse */
  | { type: "TARGET_SELECTED"; target: string; index: number; event: StreamEvent }
  /** rantai kategori habis */
  | { type: "CHAIN_EXHAUSTED"; halt: HaltInfo; event: StreamEvent }
  /** output final diterima */
  | { type: "FINAL"; result: RunResult; events: StreamEvent[] }
  /** kegagalan non-recoverable — stream beku di titik gagal */
  | { type: "FATAL"; failure: FailureInfo; event: StreamEvent }
  /** user membatalkan */
  | { type: "CANCEL"; ts: string }
  /** halted → antre lagi saat kuota reset */
  | { type: "RESUME"; ts: string }
  /** error → coba lagi, plan di-reuse */
  | { type: "RETRY"; ts: string }
  /** done/halted/error → kembali ke idle (merge / discard / buang) */
  | { type: "RESET" }
  // --- event tampilan: tidak mengubah status ---
  /** id run sebenarnya, diketahui setelah daemon membuat tugas */
  | { type: "RUN_ID"; runId: number }
  | { type: "TOGGLE_PAUSE" }
  | { type: "CLEAR_STREAM" }
  | { type: "SCROLL_AWAY" }
  | { type: "JUMP_LATEST" };

export type ConsoleEventType = ConsoleEvent["type"];

/**
 * Tabel transisi. Kunci = status sekarang, nilai = event → status berikutnya.
 * Event yang tidak terdaftar untuk sebuah status = tidak sah di situ.
 */
export const TRANSITIONS: Record<ConsoleStatus, Partial<Record<ConsoleEventType, ConsoleStatus>>> = {
  idle: {
    SUBMIT: "queued",
  },
  queued: {
    SLOT_FREE: "running",
    // Rantai bisa mulai berjalan sebelum ada target yang benar-benar start:
    // target di bawah quality_floor / kehabisan kuota dilewati lebih dulu.
    TARGET_FAILED: "cascading",
    // …dan kalau SEMUA target dilewati, run berhenti tanpa pernah running.
    CHAIN_EXHAUSTED: "halted",
    CANCEL: "halted",
    FATAL: "error",
  },
  running: {
    QUESTION: "waiting_for_input",
    TARGET_FAILED: "cascading",
    FINAL: "done",
    FATAL: "error",
    CANCEL: "halted",
  },
  waiting_for_input: {
    REPLY: "running",
    DEFER: "running",
    CANCEL: "halted",
    FATAL: "error",
  },
  cascading: {
    TARGET_SELECTED: "running",
    TARGET_FAILED: "cascading",
    CHAIN_EXHAUSTED: "halted",
    FATAL: "error",
    CANCEL: "halted",
  },
  done: {
    SUBMIT: "queued",
    RESET: "idle",
  },
  halted: {
    SUBMIT: "queued",
    RESUME: "queued",
    RESET: "idle",
  },
  error: {
    SUBMIT: "queued",
    RETRY: "queued",
    RESET: "idle",
  },
};

/** Event tampilan — sah di status apa pun, tidak menggeser status. */
const VIEW_EVENTS: ConsoleEventType[] = [
  "LOG",
  "LOG_DELTA",
  "USAGE",
  "RUN_ID",
  "TOGGLE_PAUSE",
  "CLEAR_STREAM",
  "SCROLL_AWAY",
  "JUMP_LATEST",
];

/** Status berikutnya, atau null kalau event tidak sah di status sekarang. */
export function transition(status: ConsoleStatus, event: ConsoleEventType): ConsoleStatus | null {
  if (VIEW_EVENTS.includes(event)) return status;
  return TRANSITIONS[status][event] ?? null;
}

export function canCancel(status: ConsoleStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

const EMPTY_USAGE: Usage = { in: 0, out: 0, cache: 0, total: 0 };

export const initialConsoleState: ConsoleState = {
  status: "idle",
  runId: 38,
  request: null,
  route: "—",
  stream: [],
  attempts: [],
  question: null,
  usage: EMPTY_USAGE,
  result: null,
  halt: null,
  failure: null,
  autoScroll: true,
  paused: false,
  planReused: false,
};

let synthSeq = 0;

/** Baris stream sintetis untuk transisi yang dipicu user. */
function line(ts: string, kind: StreamEvent["kind"], source: string, text: string): StreamEvent {
  synthSeq += 1;
  return { id: `sys-${synthSeq}`, ts, kind, source, text };
}

function append(state: ConsoleState, ...events: StreamEvent[]): StreamEvent[] {
  return [...state.stream, ...events];
}

export function consoleReducer(state: ConsoleState, event: ConsoleEvent): ConsoleState {
  const next = transition(state.status, event.type);
  if (next === null) return state;

  switch (event.type) {
    case "SUBMIT":
      return {
        ...initialConsoleState,
        status: next,
        runId: event.runId,
        request: event.request,
        route: "—",
        stream: [
          line(event.ts, "status", "choros", `tugas diterima — antre di kategori ${event.request.category}`),
        ],
      };

    case "SLOT_FREE":
      return {
        ...state,
        status: next,
        route: event.target,
        autoScroll: true,
        attempts:
          state.attempts.length === 0
            ? [{ index: 1, target: event.target, outcome: "running" }]
            : state.attempts,
        stream: append(
          state,
          line(event.ts, "status", "choros", `queued → running — ${event.target}`),
          line(
            event.ts,
            "info",
            "choros",
            `mode ${state.request?.mode ?? "interaktif"} — ${
              state.request?.noIsolation ? "TANPA isolasi (working tree langsung)" : "worktree terisolasi"
            }`,
          ),
        ),
      };

    case "LOG":
      return { ...state, stream: append(state, event.event) };

    case "LOG_DELTA": {
      // Dicari mundur, bukan hanya baris terakhir: event `usage` sering menyela
      // aliran output, dan blok output harus tetap jadi satu baris utuh.
      const at = state.stream.findLastIndex((e) => e.id === event.streamId);
      if (at >= 0) {
        const target = state.stream[at];
        if (!target) return state;
        const stream = [...state.stream];
        stream[at] = { ...target, text: target.text + event.text };
        return { ...state, stream };
      }
      return {
        ...state,
        stream: append(state, {
          id: event.streamId,
          ts: event.ts,
          kind: "output",
          source: event.source,
          text: event.text,
        }),
      };
    }

    case "USAGE":
      return { ...state, usage: event.usage, stream: append(state, event.event) };

    case "QUESTION":
      // auto-scroll berhenti; pertanyaan di-pin.
      return {
        ...state,
        status: next,
        question: event.event,
        autoScroll: false,
        stream: append(state, event.event),
      };

    case "REPLY":
      return {
        ...state,
        status: next,
        question: null,
        autoScroll: true,
        stream: append(state, line(event.ts, "output", "you", `› ${event.text}`)),
      };

    case "DEFER":
      return {
        ...state,
        status: next,
        question: null,
        autoScroll: true,
        stream: append(state, line(event.ts, "info", "choros", "keputusan diserahkan ke agent — melanjutkan")),
      };

    case "TARGET_FAILED": {
      const attempts = state.attempts.filter((a) => a.index !== event.attempt.index);
      return {
        ...state,
        status: next,
        question: null,
        attempts: [...attempts, event.attempt].sort((a, b) => a.index - b.index),
        stream: append(state, event.event),
      };
    }

    case "TARGET_SELECTED": {
      const attempts = state.attempts.filter((a) => a.index !== event.index);
      return {
        ...state,
        status: next,
        route: event.target,
        planReused: true,
        autoScroll: true,
        attempts: [
          ...attempts,
          { index: event.index, target: event.target, outcome: "running" as const },
        ].sort((a, b) => a.index - b.index),
        stream: append(state, event.event),
      };
    }

    case "CHAIN_EXHAUSTED":
      return { ...state, status: next, halt: event.halt, stream: append(state, event.event) };

    case "FINAL": {
      const attempts = state.attempts.map((a) =>
        a.outcome === "running" || a.outcome === "trying" ? { ...a, outcome: "ok" as const, note: "selesai di target ini" } : a,
      );
      return {
        ...state,
        status: next,
        // Daemon nyata tidak menghitung token; ambil dari usage yang sudah menetes.
        result: { ...event.result, tokens: event.result.tokens || state.usage.total },
        attempts,
        stream: append(state, ...event.events),
      };
    }

    case "FATAL":
      // stream dibekukan pada titik gagal — tidak ada baris tambahan setelah ini.
      return { ...state, status: next, failure: event.failure, question: null, stream: append(state, event.event) };

    case "CANCEL":
      return {
        ...state,
        status: next,
        question: null,
        halt: { reason: "cancelled", message: "Run dibatalkan — plan tersimpan." },
        stream: append(state, line(event.ts, "status", "choros", "dibatalkan oleh operator — run dihentikan dengan rapi")),
      };

    case "RESUME":
      return {
        ...state,
        status: next,
        halt: null,
        planReused: true,
        stream: append(state, line(event.ts, "status", "choros", "antre ulang — plan di-reuse")),
      };

    case "RETRY":
      return {
        ...state,
        status: next,
        failure: null,
        planReused: true,
        stream: append(state, line(event.ts, "status", "choros", "coba lagi — plan di-reuse")),
      };

    case "RESET":
      return { ...initialConsoleState, runId: state.runId, status: next };

    case "RUN_ID":
      return { ...state, runId: event.runId };

    case "TOGGLE_PAUSE":
      return { ...state, paused: !state.paused };

    case "CLEAR_STREAM":
      return { ...state, stream: [] };

    case "SCROLL_AWAY":
      return state.autoScroll ? { ...state, autoScroll: false } : state;

    case "JUMP_LATEST":
      // waiting_for_input mempertahankan auto-scroll mati sampai dijawab.
      return { ...state, autoScroll: state.status !== "waiting_for_input", paused: false };

    default:
      return state;
  }
}
