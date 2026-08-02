/**
 * Adaptor stream nyata — TITIK INTEGRASI.
 *
 * Dipetakan ke kontrak yang sudah ada di backend choros:
 *   GET  /api/tasks/{id}/stream   → SSE, payload `app/events.py::Event.as_dict()`
 *   POST /api/tasks/{id}/reply    → jawaban untuk event `question`
 *   POST /api/tasks/{id}/cancel   → hentikan run
 *
 * Status file ini: ditulis mengikuti kontrak backend, BELUM diuji terhadap daemon
 * yang berjalan. `App.tsx` masih memakai `createMockDaemon`. Menukarnya = mengganti
 * satu baris factory di `useConsole()`.
 *
 * Satu hal yang perlu backend tambahkan sebelum ini bisa dipakai penuh:
 * transisi cascade sekarang hanya bisa dibaca dari teks `status.message`. Supaya
 * mapper tidak menebak dari kalimat, event `status` sebaiknya membawa field
 * eksplisit — lihat `interpretStatus()` di bawah.
 */

import type { ConsoleEvent } from "../state/consoleMachine";
import type { RunRequest, StreamEvent } from "../state/types";
import { eventId, fmt, nowTs, type DaemonClient, type DaemonSink } from "./daemon";

/** Bentuk kawat sesuai `Event.as_dict()` di app/events.py. */
interface WireEvent {
  type: "thinking" | "tool_call" | "file_edit" | "output" | "question" | "usage" | "error" | "status" | "eof";
  agent: string | null;
  model: string | null;
  ts: number;
  data: Record<string, unknown>;
}

/** kind error yang berarti "target ini tidak bisa dipakai" (CASCADE_TRIGGERS di backend). */
const CASCADE_TRIGGERS = new Set([
  "rate_limit",
  "auth",
  "crash",
  "not_installed",
  "timeout",
  "permission_denied",
]);

const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const n = (v: unknown): number => (typeof v === "number" ? v : 0);

function source(w: WireEvent): string {
  if (w.agent && w.model) return `${w.agent}/${w.model}`;
  return w.agent ?? "choros";
}

function tsOf(w: WireEvent): string {
  return w.ts ? nowTs(new Date(w.ts * 1000)) : nowTs();
}

function line(w: WireEvent, kind: StreamEvent["kind"], text: string, detail?: string[]): StreamEvent {
  return { id: eventId("w"), ts: tsOf(w), kind, source: source(w), text, ...(detail ? { detail } : {}) };
}

/**
 * `status` adalah satu-satunya tipe yang membawa transisi orkestrator. Selama
 * backend belum mengirim field eksplisit (`data.transition`, `data.target`,
 * `data.attempt`), baris status hanya masuk sebagai log biasa — lebih baik
 * kehilangan animasi cascade daripada salah menebak state dari kalimat.
 */
function interpretStatus(w: WireEvent): ConsoleEvent[] {
  const message = s(w.data.message);
  const transitionField = s(w.data.transition);
  const target = s(w.data.target);

  switch (transitionField) {
    case "started":
      return [{ type: "SLOT_FREE", target: target || source(w), ts: tsOf(w) }];
    case "target_selected":
      return [
        {
          type: "TARGET_SELECTED",
          target,
          index: n(w.data.attempt) || 1,
          event: line(w, "status", message),
        },
      ];
    case "chain_exhausted":
      return [
        {
          type: "CHAIN_EXHAUSTED",
          halt: {
            reason: "chain_exhausted",
            message,
            ...(s(w.data.reset_in) ? { resetIn: s(w.data.reset_in) } : {}),
          },
          event: line(w, "status", message),
        },
      ];
    default:
      return [{ type: "LOG", event: line(w, "status", message) }];
  }
}

export function toConsoleEvents(w: WireEvent): ConsoleEvent[] {
  switch (w.type) {
    case "thinking": {
      const text = s(w.data.text);
      const parts = text.split("\n").filter(Boolean);
      const head = parts.length > 1 ? `thinking — ${parts.length} langkah` : text;
      return [{ type: "LOG", event: line(w, "thinking", head, parts.length > 1 ? parts : undefined) }];
    }
    case "tool_call":
      return [
        {
          type: "LOG",
          event: line(w, "tool_call", `${s(w.data.name)} ${JSON.stringify(w.data.input ?? {})}`),
        },
      ];
    case "file_edit":
      return [{ type: "LOG", event: line(w, "file_edit", `✓ ${s(w.data.action, "edit")} ${s(w.data.path)}`) }];
    case "output":
      return [{ type: "LOG", event: line(w, "output", s(w.data.text)) }];
    case "question":
      return [{ type: "QUESTION", event: line(w, "question", `question — ${s(w.data.text)}`) }];
    case "usage": {
      const usage = {
        in: n(w.data.input_tokens ?? w.data.in),
        out: n(w.data.output_tokens ?? w.data.out),
        cache: n(w.data.cache_tokens ?? w.data.cache),
        total: n(w.data.total_tokens ?? w.data.total),
      };
      return [
        {
          type: "USAGE",
          usage,
          event: line(
            w,
            "usage",
            `in=${fmt(usage.in)} out=${fmt(usage.out)} cache=${fmt(usage.cache)} total=${fmt(usage.total)} tok`,
          ),
        },
      ];
    }
    case "error": {
      const kind = s(w.data.kind);
      const message = s(w.data.message);
      if (CASCADE_TRIGGERS.has(kind)) {
        return [
          {
            type: "TARGET_FAILED",
            attempt: {
              index: n(w.data.attempt) || 1,
              target: source(w),
              outcome: "failed",
              reason: kind === "rate_limit" ? "429 / limit" : kind,
              note: "jatuh ke target berikut",
            },
            event: line(w, "limit", message),
          },
        ];
      }
      return [
        {
          type: "FATAL",
          failure: { message, stack: Array.isArray(w.data.stack) ? (w.data.stack as string[]) : [] },
          event: line(w, "error", `✗ ${message}`),
        },
      ];
    }
    case "status":
      return interpretStatus(w);
    case "eof":
      return [];
    default:
      return [];
  }
}

export interface SseDaemonOptions {
  /** Membuat task di backend dan mengembalikan id-nya. */
  createTask: (request: RunRequest) => Promise<number>;
  baseUrl?: string;
}

export function createSseDaemon(sink: DaemonSink, opts: SseDaemonOptions): DaemonClient {
  const base = opts.baseUrl ?? "";
  let es: EventSource | null = null;
  let taskId: number | null = null;

  const close = () => {
    es?.close();
    es = null;
  };

  return {
    submit(request) {
      close();
      void opts
        .createTask(request)
        .then((id) => {
          taskId = id;
          es = new EventSource(`${base}/api/tasks/${id}/stream`);
          es.onmessage = (msg) => {
            const wire = JSON.parse(msg.data) as WireEvent;
            if (wire.type === "eof") {
              close();
              return;
            }
            for (const e of toConsoleEvents(wire)) sink(e);
          };
          es.onerror = () => {
            sink({
              type: "FATAL",
              failure: { message: "koneksi stream putus", stack: [] },
              event: {
                id: eventId("w"),
                ts: nowTs(),
                kind: "error",
                source: "choros",
                text: "✗ koneksi stream putus",
              },
            });
            close();
          };
        })
        .catch((err: unknown) => {
          sink({
            type: "FATAL",
            failure: { message: String(err), stack: [] },
            event: {
              id: eventId("w"),
              ts: nowTs(),
              kind: "error",
              source: "choros",
              text: `✗ gagal membuat tugas — ${String(err)}`,
            },
          });
        });
    },
    reply(text) {
      sink({ type: "REPLY", text, ts: nowTs() });
      if (taskId === null) return;
      void fetch(`${base}/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
    },
    defer() {
      sink({ type: "DEFER", ts: nowTs() });
      if (taskId === null) return;
      void fetch(`${base}/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "", defer: true }),
      });
    },
    cancel() {
      sink({ type: "CANCEL", ts: nowTs() });
      if (taskId === null) return;
      void fetch(`${base}/api/tasks/${taskId}/cancel`, { method: "POST" });
      close();
    },
    dispose() {
      close();
    },
  };
}
