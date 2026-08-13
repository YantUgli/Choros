/**
 * Adaptor daemon nyata — dipakai Console secara default.
 *
 * Kontrak backend (app/api/tasks.py):
 *   POST /api/tasks               → buat tugas, jalankan runner   (TaskIn)
 *   GET  /api/tasks/{id}/stream   → SSE; replay event tersimpan lalu ikuti live,
 *                                   diakhiri {"type":"eof"}
 *   POST /api/tasks/{id}/reply    → {answer}; MEMBUAT TUGAS BARU yang me-resume
 *                                   sesi yang sama → stream pindah ke id baru
 *   POST /api/tasks/{id}/cancel   → hentikan run
 *   GET  /api/tasks/{id}          → status akhir (rekonsiliasi saat eof)
 *   GET  /api/tasks/{id}/diff     → worktree review (mode otonom saja)
 *
 * Bentuk event mengikuti `app/events.py::Event.as_dict()`. Transisi orkestrator
 * dibaca dari field `data.transition` yang eksplisit — bukan dari kalimat
 * `data.message`.
 */

import type { ConsoleEvent } from "../state/consoleMachine";
import type { RunRequest, StreamEvent, Usage } from "../state/types";
import { eventId, fmt, nowTs, type DaemonClient, type DaemonSink } from "./daemon";

export interface WireEvent {
  type:
    | "thinking"
    | "tool_call"
    | "file_edit"
    | "output"
    | "question"
    | "usage"
    | "error"
    | "status"
    | "eof";
  agent?: string | null;
  model?: string | null;
  ts?: number;
  seq?: number;
  data: Record<string, unknown>;
}

export interface WireTaskOut {
  id: number;
  prompt: string;
  category: string;
  mode: string;
  status: string;
  project_path: string | null;
  workspace_path: string | null;
  final_output: string | null;
  created_at: string | null;
  finished_at: string | null;
}

/** kind error yang berarti "target ini tidak bisa dipakai" (CASCADE_TRIGGERS di app/events.py). */
const CASCADE_TRIGGERS = new Set([
  "rate_limit",
  "auth",
  "crash",
  "not_installed",
  "timeout",
  "permission_denied",
]);

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

function sourceOf(w: WireEvent): string {
  if (w.agent && w.model) return `${w.agent}/${w.model}`;
  return w.agent || "choros";
}

function tsOf(w: WireEvent): string {
  return w.ts ? nowTs(new Date(w.ts * 1000)) : nowTs();
}

function line(w: WireEvent, kind: StreamEvent["kind"], text: string, detail?: string[]): StreamEvent {
  return {
    id: eventId("w"),
    ts: tsOf(w),
    kind,
    source: sourceOf(w),
    text,
    ...(detail && detail.length > 0 ? { detail } : {}),
  };
}

/** HH:MM:SS sisa menuju `iso`. */
export function countdownTo(iso: string, from: Date = new Date()): string | undefined {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return undefined;
  const secs = Math.max(0, Math.round((target - from.getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Transisi orkestrator — hanya dari field eksplisit, tidak pernah dari prosa. */
function fromStatus(w: WireEvent): ConsoleEvent[] {
  const message = str(w.data.message);
  const transition = str(w.data.transition);
  const target = str(w.data.target) || sourceOf(w);
  const attempt = num(w.data.attempt) || 1;
  const resetAt = str(w.data.reset_at);

  switch (transition) {
    case "target_started": {
      const started: ConsoleEvent[] = [
        { type: "SLOT_FREE", target, ts: tsOf(w) },
        {
          type: "TARGET_SELECTED",
          target,
          index: attempt,
          event: line(w, "status", message),
        },
      ];
      // Attempt pertama cukup SLOT_FREE (idle/queued → running).
      // Attempt berikutnya datang dari state cascading → TARGET_SELECTED.
      return started;
    }
    case "target_skipped":
      return [
        {
          type: "TARGET_FAILED",
          attempt: {
            index: attempt,
            target,
            outcome: "skipped",
            reason: str(w.data.reason, "dilewati"),
            note: "dilewati",
          },
          event: line(w, "info", message),
        },
      ];
    case "target_failed":
      return [
        {
          type: "TARGET_FAILED",
          attempt: {
            index: attempt,
            target,
            outcome: "failed",
            reason: str(w.data.reason, "gagal"),
            note: "jatuh ke target berikut",
          },
          event: line(w, "limit", message),
        },
      ];
    case "chain_exhausted":
      return [
        {
          type: "CHAIN_EXHAUSTED",
          halt: {
            reason: "chain_exhausted",
            message,
            ...(resetAt && countdownTo(resetAt) ? { resetIn: countdownTo(resetAt) as string } : {}),
          },
          event: line(w, "status", message),
        },
      ];
    case "cancelled":
    case "queued":
    case "done":
    default:
      return [{ type: "LOG", event: line(w, "status", message) }];
  }
}

/**
 * Petakan satu event kawat ke event state machine.
 * `partial` output dikembalikan sebagai LOG_DELTA supaya menyatu jadi satu baris.
 */
export function toConsoleEvents(w: WireEvent, partialId: string | null): ConsoleEvent[] {
  switch (w.type) {
    case "thinking": {
      const text = str(w.data.text);
      const parts = text.split("\n").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        return [{ type: "LOG", event: line(w, "thinking", `thinking — ${parts.length} langkah`, parts) }];
      }
      return [{ type: "LOG", event: line(w, "thinking", text) }];
    }
    case "tool_call": {
      const input = w.data.input;
      const rendered =
        input == null ? "" : ` ${typeof input === "string" ? input : JSON.stringify(input)}`;
      const err = str(w.data.error);
      return [
        {
          type: "LOG",
          event: line(w, "tool_call", `${str(w.data.name)}${rendered}${err ? ` ✗ ${err}` : ""}`),
        },
      ];
    }
    case "file_edit":
      return [
        { type: "LOG", event: line(w, "file_edit", `✓ ${str(w.data.action, "edit")} ${str(w.data.path)}`) },
      ];
    case "output": {
      if (w.data.partial) {
        return [
          {
            type: "LOG_DELTA",
            streamId: partialId ?? eventId("p"),
            ts: tsOf(w),
            source: sourceOf(w),
            text: str(w.data.text),
          },
        ];
      }
      // `final` adalah ringkasan akhir yang sama dengan potongan partial yang
      // sudah tampil — tempatnya di strip Hasil, bukan diulang di stream.
      if (w.data.final) return [];
      const text = str(w.data.text);
      if (!text.trim()) return [];
      return [{ type: "LOG", event: line(w, "output", text) }];
    }
    case "question":
      return [{ type: "QUESTION", event: line(w, "question", `question — ${str(w.data.text)}`) }];
    case "usage": {
      const usage: Usage = {
        in: num(w.data.input_tokens),
        out: num(w.data.output_tokens),
        cache: num(w.data.cache_read_tokens) + num(w.data.cache_write_tokens),
        total: num(w.data.total_tokens),
      };
      const cost = num(w.data.cost_usd);
      return [
        {
          type: "USAGE",
          usage,
          event: line(
            w,
            "usage",
            `in=${fmt(usage.in)} out=${fmt(usage.out)} cache=${fmt(usage.cache)} total=${fmt(usage.total)} tok` +
              (cost ? ` · $${cost.toFixed(4)}` : ""),
          ),
        },
      ];
    }
    case "error": {
      const kind = str(w.data.kind);
      const message = str(w.data.message);
      if (CASCADE_TRIGGERS.has(kind)) {
        // Baris informatif saja: keputusan cascade datang dari status
        // `target_failed` yang menyusul, supaya percobaan tidak terhitung dua kali.
        return [{ type: "LOG", event: line(w, "limit", `[${kind}] ${message}`) }];
      }
      return [{ type: "LOG", event: line(w, "error", `✗ [${kind}] ${message}`) }];
    }
    case "status":
      return fromStatus(w);
    case "eof":
      return [];
    default:
      return [];
  }
}

const MODE_WIRE: Record<RunRequest["mode"], "interactive" | "autonomous"> = {
  interaktif: "interactive",
  otonom: "autonomous",
};

async function json<T>(input: Response | Promise<Response>): Promise<T> {
  const res = await input;
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (parsed.detail) detail = String(parsed.detail);
    } catch {
      /* biarkan teks apa adanya */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export interface SseDaemonOptions {
  baseUrl?: string;
  /** Dipanggil saat id tugas berganti (submit / follow-up), untuk label run. */
  onTaskId?: (id: number) => void;
}

export function createSseDaemon(sink: DaemonSink, opts: SseDaemonOptions = {}): DaemonClient {
  const base = opts.baseUrl ?? "";
  let es: EventSource | null = null;
  let taskId: number | null = null;
  let partialId: string | null = null;
  /** true selama pertanyaan agent menahan run — eof tidak boleh menutupnya. */
  let questionPending = false;
  // Sambung-ulang setelah koneksi SSE putus SEMENTARA pada run yang belum selesai.
  // EventSource yang kita tutup sendiri (closeStream) tidak auto-reconnect, jadi
  // kalau tidak disambung ulang panel menggantung di "queued" sampai reload.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;
  // Polling REST untuk jalur ATTACH (lane hasil delegasi / run lama). EventSource
  // ke task yang sedang/sudah berjalan terbukti tidak andal di browser (macet /
  // datang sebagai kilatan), sementara fetch biasa selalu mulus — jadi lane
  // di-attach lewat polling, bukan SSE. Submit (lane 0) tetap pakai SSE.
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const stopPolling = () => {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const closeStream = () => {
    clearReconnect();
    stopPolling();
    es?.close();
    es = null;
  };

  const fail = (message: string, stack: string[] = []) => {
    sink({
      type: "FATAL",
      failure: { message, stack },
      event: { id: eventId("w"), ts: nowTs(), kind: "error", source: "choros", text: `✗ ${message}` },
    });
  };

  /**
   * Saat stream habis: tanyakan status sebenarnya ke backend, jangan menebak.
   * `streamEnded` = server mengirim eof (runner PASTI tidak lagi menjalankan task);
   * false = koneksi putus (mungkin sementara) → jangan bunuh run non-terminal.
   */
  const reconcile = async (id: number, streamEnded = true) => {
    if (questionPending) return; // menunggu jawaban user — bukan akhir run
    try {
      const task = await json<WireTaskOut>(await fetch(`${base}/api/tasks/${id}`));
      if (task.status === "ok") {
        const duration =
          task.created_at && task.finished_at
            ? `${Math.max(1, Math.round((Date.parse(task.finished_at) - Date.parse(task.created_at)) / 1000))}s`
            : "—";
        let added = 0;
        let removed = 0;
        let files = 0;
        const isolated = task.mode === "autonomous" && Boolean(task.project_path);
        if (isolated) {
          try {
            const diff = await json<{ diff?: string; status?: string }>(
              await fetch(`${base}/api/tasks/${id}/diff`),
            );
            const lines = (diff.diff ?? "").split("\n");
            added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
            removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
            files = (diff.status ?? "").split("\n").filter((l) => l.trim()).length;
          } catch {
            /* diff opsional — run tetap selesai */
          }
        }
        sink({
          type: "FINAL",
          result: {
            summary: task.final_output?.trim() || "Tugas selesai — tidak ada output teks.",
            worktree: task.workspace_path ?? task.project_path ?? "",
            isolated,
            filesChanged: files,
            added,
            removed,
            tokens: 0,
            duration,
          },
          events: [],
        });
      } else if (task.status === "halted") {
        sink({
          type: "CHAIN_EXHAUSTED",
          halt: { reason: "chain_exhausted", message: "Rantai target habis — plan tersimpan." },
          event: {
            id: eventId("w"),
            ts: nowTs(),
            kind: "status",
            source: "choros",
            text: "run berhenti — semua target habis",
          },
        });
      } else if (task.status === "error") {
        fail("run berakhir dengan error — lihat log di atas");
      } else if (task.status === "cancelled") {
        sink({ type: "CANCEL", ts: nowTs() });
      } else if (task.status === "interrupted") {
        // Ditandai `recover_interrupted_tasks` saat server/orchestrator restart.
        // Tanpa cabang ini, attach menggantung selamanya di "menyambung…".
        fail(
          "sesi terputus — server/orchestrator sempat restart sebelum run selesai. " +
            "Mulai ulang tugas ini untuk melanjutkan (plan tersimpan).",
        );
      } else if (streamEnded) {
        // queued/running/waiting_for_input tapi stream sudah eof → runner tidak
        // lagi hidup untuk task ini. Jangan biarkan konsol menggantung.
        fail(
          `sesi tidak lagi aktif (status: ${task.status}) — proses berhenti tanpa menutup run. ` +
            "Mulai ulang atau kirim lanjutan.",
        );
      } else if (taskId === id && reconnectAttempts < MAX_RECONNECT) {
        // Koneksi putus SEMENTARA pada run yang masih berjalan (bukan eof). Kita
        // sudah menutup EventSource sendiri, jadi ia tak akan menyambung otomatis
        // — sambung ulang dengan backoff kecil. Kalau task keburu selesai, replay
        // + eof di koneksi baru akan menyelesaikannya.
        reconnectAttempts += 1;
        clearReconnect();
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (taskId === id) openStream(id);
        }, 1000 * reconnectAttempts);
      }
      // else: sudah pindah task / jatah retry habis → biarkan; reload menyambung.
    } catch (err) {
      fail(`gagal membaca status tugas: ${String(err)}`);
    }
  };

  /** Terapkan satu event kawat ke konsol (dipakai stream live & replay REST). */
  const applyWire = (wire: WireEvent) => {
    if (wire.type === "question") questionPending = true;
    if (wire.type === "output" && wire.data.partial) {
      if (partialId === null) partialId = eventId("p");
    } else if (wire.type !== "usage") {
      // `usage` menetes di tengah aliran output; ia tidak memutus blok teks
      // yang sedang berjalan. Event lain menutupnya.
      partialId = null;
    }
    for (const e of toConsoleEvents(wire, partialId)) {
      sink(e);
    }
  };

  /** Status task yang masih "hidup" — polling terus selama salah satu ini. */
  const LIVE_STATUS = ["queued", "running", "waiting_for_input"];

  /**
   * ATTACH via polling REST (bukan SSE). Ambil event tersimpan tiap ~1,5 dtk,
   * terapkan yang baru (seq > terakhir), dan berhenti begitu task terminal lalu
   * rekonsiliasi ke hasil. Menangani task yang masih berjalan (near-live) maupun
   * yang sudah selesai (satu putaran) dengan andal — tanpa EventSource yang rawan
   * macet di jalur attach.
   */
  const attachLive = (id: number) => {
    closeStream();
    taskId = id;
    partialId = null;
    opts.onTaskId?.(id);
    let lastSeq = 0;
    const tick = async () => {
      if (taskId !== id) return; // sudah pindah ke task lain
      try {
        const events = await json<Array<WireEvent & { seq?: number }>>(
          await fetch(`${base}/api/tasks/${id}/events`),
        );
        for (const wire of events) {
          const seq = wire.seq ?? 0;
          if (seq <= lastSeq) continue;
          lastSeq = seq;
          applyWire(wire);
        }
        const task = await json<WireTaskOut>(await fetch(`${base}/api/tasks/${id}`));
        if (!LIVE_STATUS.includes(task.status)) {
          questionPending = false; // terminal → tak ada pertanyaan menggantung
          await reconcile(id, true);
          return; // berhenti polling
        }
      } catch {
        // hiccup sementara — coba lagi di tick berikutnya
      }
      if (taskId === id) pollTimer = setTimeout(() => void tick(), 1500);
    };
    void tick();
  };

  const openStream = (id: number) => {
    closeStream();
    taskId = id;
    opts.onTaskId?.(id);
    const source = new EventSource(`${base}/api/tasks/${id}/stream`);
    es = source;
    source.onmessage = (msg) => {
      let wire: WireEvent;
      try {
        wire = JSON.parse(msg.data) as WireEvent;
      } catch {
        return;
      }
      // Stream sehat: nol-kan hitungan retry agar drop di kemudian hari tetap
      // dapat jatah sambung-ulang penuh.
      reconnectAttempts = 0;
      if (wire.type === "eof") {
        closeStream();
        void reconcile(id);
        return;
      }
      applyWire(wire);
    };
    source.onerror = () => {
      // EventSource menutup koneksi sendiri saat server selesai; hanya laporkan
      // kalau memang belum sempat menerima eof.
      if (es !== source) return;
      closeStream();
      void reconcile(id, false);
    };
  };

  const DEFER_ANSWER = "Lanjutkan dengan asumsi terbaikmu, tidak perlu bertanya.";

  /** POST /reply → tugas lanjutan yang me-resume sesi yang sama; stream pindah ke id baru. */
  const resume = (answer: string, gagal: string) => {
    if (taskId === null) return;
    questionPending = false;
    partialId = null;
    void json<WireTaskOut>(
      fetch(`${base}/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer }),
      }),
    )
      .then((task) => openStream(task.id))
      .catch((err: unknown) => fail(`${gagal} — ${String(err)}`));
  };

  return {
    attach(id: number) {
      attachLive(id);
    },
    
    submit(request) {
      questionPending = false;
      partialId = null;
      void json<WireTaskOut>(
        fetch(`${base}/api/tasks`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: request.prompt,
            category: request.category,
            mode: MODE_WIRE[request.mode],
            project_path: request.projectPath || null,
            quality_floor: request.qualityFloor,
            allow_unisolated: request.noIsolation,
            task_run_id: request.taskRunId,
          }),
        }),
      )
        .then((task) => openStream(task.id))
        .catch((err: unknown) => fail(`gagal membuat tugas — ${String(err)}`));
    },

    reply(text) {
      sink({ type: "REPLY", text, ts: nowTs() });
      resume(text, "follow-up gagal");
    },

    defer() {
      sink({ type: "DEFER", ts: nowTs() });
      resume(DEFER_ANSWER, "follow-up gagal");
    },

    followUp(text) {
      sink({ type: "FOLLOW_UP", text, ts: nowTs() });
      resume(text, "lanjutan gagal");
    },

    cancel() {
      sink({ type: "CANCEL", ts: nowTs() });
      questionPending = false;
      if (taskId === null) return;
      void fetch(`${base}/api/tasks/${taskId}/cancel`, { method: "POST" }).catch(() => {});
      closeStream();
    },

    dispose() {
      closeStream();
    },
  };
}
