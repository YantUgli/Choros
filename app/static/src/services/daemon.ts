/**
 * Layer service daemon.
 *
 * UI tidak pernah tahu event datang dari mana. Ia hanya menerima `ConsoleEvent`
 * lewat `sink` dan memanggil perintah di `DaemonClient`. Mengganti mock dengan
 * stream nyata = mengganti satu pemanggilan factory di `useConsole`
 * (lihat `sseDaemon.ts` untuk adaptor SSE ke `/api/tasks/{id}/stream`).
 */

import type { ConsoleEvent } from "../state/consoleMachine";
import type { RunRequest } from "../state/types";

export type DaemonSink = (event: ConsoleEvent) => void;

export interface DaemonClient {
  /** Sambungkan stream dari task lama/berjalan (tanpa submit). */
  attach(taskId: number): void;
  /** Kirim tugas baru. Daemon membalas SLOT_FREE lalu aliran event. */
  submit(request: RunRequest, runId: number): void;
  /** Jawab event `question` yang sedang menahan run. */
  reply(text: string): void;
  /** Lanjutan setelah run selesai — resume sesi yang sama, tugas baru. */
  followUp(text: string): void;
  /** Serahkan keputusan ke agent — run lanjut tanpa jawaban user. */
  defer(): void;
  /** Hentikan run berjalan. Daemon berhenti mengirim event. */
  cancel(): void;
  /** Lepas semua timer/koneksi. */
  dispose(): void;
}

/** Skenario mock — memberi jalan ke seluruh cabang state machine. */
export type ScenarioId = "cascade_tanya" | "lancar" | "tanya" | "cascade" | "habis" | "crash";

export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "cascade_tanya", label: "cascade + tanya → done" },
  { id: "lancar", label: "lancar → done" },
  { id: "tanya", label: "tanya → done" },
  { id: "cascade", label: "cascade → done" },
  { id: "habis", label: "rantai habis → halted" },
  { id: "crash", label: "crash → error" },
];

export function nowTs(d: Date = new Date()): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

let eventSeq = 0;
export function eventId(prefix = "e"): string {
  eventSeq += 1;
  return `${prefix}-${eventSeq}`;
}

export const fmt = (n: number): string => n.toLocaleString("en-US");
