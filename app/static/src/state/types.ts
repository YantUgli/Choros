/** Tipe domain Console — dipakai bersama oleh state machine, service daemon, dan UI. */

export type ConsoleStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "cascading"
  | "done"
  | "halted"
  | "error";

/** State akhir: tidak ada transisi keluar kecuali user memulai run baru. */
export const TERMINAL_STATUSES: readonly ConsoleStatus[] = ["done", "halted", "error"];

/** State yang bisa dibatalkan user → halted. */
export const CANCELLABLE_STATUSES: readonly ConsoleStatus[] = [
  "queued",
  "running",
  "waiting_for_input",
  "cascading",
];

/** State di mana run sedang dipegang daemon (compose terkunci). */
export const BUSY_STATUSES: readonly ConsoleStatus[] = [
  "queued",
  "running",
  "waiting_for_input",
  "cascading",
];

/** Tipe event stream — menentukan tag mono + warna gutter di LogLine. */
export type EventKind =
  | "status"
  | "info"
  | "thinking"
  | "tool_call"
  | "file_edit"
  | "output"
  | "question"
  | "usage"
  | "limit"
  | "error";

export interface StreamEvent {
  id: string;
  ts: string;
  kind: EventKind;
  source: string;
  text: string;
  /** Isi yang bisa di-collapse: badan `thinking`, stack trace `error`. */
  detail?: string[];
}

export type TaskCategory = "coding_complex" | "coding_quick" | "text_long" | "text_quick";
export type TaskMode = "interaktif" | "otonom";

export interface RunRequest {
  prompt: string;
  category: TaskCategory;
  mode: TaskMode;
  projectPath: string;
  /** null = "— tanpa batas" */
  qualityFloor: number | null;
  /** true = menulis langsung ke working tree, tanpa worktree terisolasi. */
  noIsolation: boolean;
}

/** Satu percobaan target dalam rantai prioritas — bahan cerita panel Cascade. */
export type AttemptOutcome = "failed" | "skipped" | "trying" | "running" | "ok";

export interface CascadeAttempt {
  index: number;
  target: string;
  outcome: AttemptOutcome;
  /** Alasan mesin, flat: "429 / limit", "exhausted", "< quality_floor". */
  reason?: string;
  /** Apa yang terjadi setelahnya: "jatuh ke target berikut", "dilewati". */
  note?: string;
}

export interface Usage {
  in: number;
  out: number;
  cache: number;
  total: number;
}

export interface RunResult {
  summary: string;
  target: string;
  worktree: string;
  filesChanged: number;
  added: number;
  removed: number;
  tokens: number;
  duration: string;
}

export interface HaltInfo {
  /** "chain_exhausted" = rantai habis · "cancelled" = dibatalkan user. */
  reason: "chain_exhausted" | "cancelled";
  message: string;
  /** Countdown reset terdekat, HH:MM:SS — sumber sama dengan layar Quota. */
  resetIn?: string;
}

export interface FailureInfo {
  message: string;
  stack: string[];
}

export interface ConsoleState {
  status: ConsoleStatus;
  runId: number;
  request: RunRequest | null;
  route: string;
  stream: StreamEvent[];
  attempts: CascadeAttempt[];
  question: StreamEvent | null;
  usage: Usage;
  result: RunResult | null;
  halt: HaltInfo | null;
  failure: FailureInfo | null;
  /** false saat waiting_for_input / user menggulir ke atas → jump-to-latest muncul. */
  autoScroll: boolean;
  /** Jeda tampilan saja — event tetap direkam. */
  paused: boolean;
  /** Plan artifact dipakai ulang oleh target berikutnya setelah cascade. */
  planReused: boolean;
}
