/**
 * Mock daemon — memutar skrip event realistis dengan jeda waktu nyata.
 *
 * Bukan simulasi asal-asalan: urutan, isi, dan angka mengikuti file design
 * (run #38, refactor auth → httponly cookie) supaya setiap cabang state machine
 * bisa dilihat apa adanya. Ganti dengan `createSseDaemon` saat daemon nyata siap.
 */

import type { ConsoleEvent } from "../state/consoleMachine";
import type { RunRequest, StreamEvent, Usage } from "../state/types";
import { eventId, fmt, nowTs, type DaemonClient, type DaemonSink, type ScenarioId } from "./daemon";

const ev = (kind: StreamEvent["kind"], source: string, text: string, detail?: string[]): StreamEvent => ({
  id: eventId(),
  ts: nowTs(),
  kind,
  source,
  text,
  ...(detail ? { detail } : {}),
});

const T1 = "antigravity/default";
const T2 = "opencode-zen/glm-5-free";
const T3 = "claude/sonnet";

interface Step {
  /** jeda sebelum langkah ini, ms */
  after: number;
  /** null = langkah menahan run sampai user membalas (question) */
  emit: ((ctx: Ctx) => ConsoleEvent[]) | null;
}

interface Ctx {
  request: RunRequest;
  usage: Usage;
}

function usageStep(ctx: Ctx, add: Usage, source: string): ConsoleEvent[] {
  ctx.usage = {
    in: ctx.usage.in + add.in,
    out: ctx.usage.out + add.out,
    cache: ctx.usage.cache + add.cache,
    total: ctx.usage.total + add.total,
  };
  const u = ctx.usage;
  return [
    {
      type: "USAGE",
      usage: { ...u },
      event: ev(
        "usage",
        source,
        `in=${fmt(u.in)} out=${fmt(u.out)} cache=${fmt(u.cache)} total=${fmt(u.total)} tok`,
      ),
    },
  ];
}

const log = (kind: StreamEvent["kind"], source: string, text: string, detail?: string[]): ConsoleEvent => ({
  type: "LOG",
  event: ev(kind, source, text, detail),
});

/** Pembuka yang sama untuk semua skenario: slot didapat, plan disusun, satu edit. */
function opening(target: string): Step[] {
  return [
    { after: 700, emit: () => [{ type: "SLOT_FREE", target, ts: nowTs() }] },
    {
      after: 900,
      emit: () => [
        log("thinking", target.split("/")[0] ?? target, "merencanakan — 4 langkah", [
          "1. baca modul auth",
          "2. petakan pemakaian token",
          "3. tulis ulang penyimpanan ke httponly cookie",
          "4. jalankan typecheck",
        ]),
      ],
    },
    {
      after: 1100,
      emit: (ctx) => [
        log("tool_call", target.split("/")[0] ?? target, `list_dir {"DirectoryPath":"${ctx.request.projectPath || "C:\\project"}\\src"}`),
      ],
    },
    { after: 900, emit: () => [log("file_edit", target.split("/")[0] ?? target, "✓ edit src/auth/token.ts (+18 −4)")] },
    { after: 700, emit: (ctx) => usageStep(ctx, { in: 2800, out: 378, cache: 0, total: 3178 }, "usage") },
  ];
}

function cascadeSteps(): Step[] {
  return [
    {
      after: 1200,
      emit: () => [
        {
          type: "TARGET_FAILED",
          attempt: { index: 1, target: T1, outcome: "failed", reason: "429 / limit", note: "jatuh ke target berikut" },
          event: ev("limit", "antigravity", "429 rate limited — cascading ke target berikut"),
        },
      ],
    },
    {
      after: 800,
      emit: () => [
        {
          type: "TARGET_FAILED",
          attempt: { index: 2, target: T2, outcome: "skipped", reason: "< quality_floor", note: "dilewati" },
          event: ev("info", "choros", `${T2} dilewati — < quality_floor`),
        },
      ],
    },
    {
      after: 1000,
      emit: () => [
        {
          type: "TARGET_SELECTED",
          target: T3,
          index: 3,
          event: ev("status", "choros", `resume di ${T3} — plan di-reuse (percobaan 3)`),
        },
      ],
    },
    { after: 700, emit: () => [log("output", T3, "menghubungkan — sesi baru dimulai…")] },
  ];
}

function questionStep(target: string): Step[] {
  return [
    {
      after: 1200,
      emit: () => [
        {
          type: "QUESTION",
          event: ev(
            "question",
            target,
            "question — simpan refresh-token di httponly cookie juga, atau hanya access-token?",
          ),
        },
      ],
    },
    { after: 0, emit: null },
  ];
}

function finishSteps(target: string): Step[] {
  return [
    { after: 1200, emit: () => [log("output", target, "menerapkan httponly untuk access + refresh token…")] },
    { after: 1100, emit: () => [log("file_edit", target, "✓ edit src/auth/session.ts (+31 −9)")] },
    { after: 900, emit: () => [log("file_edit", target, "✓ edit src/auth/middleware.ts (+15 −5)")] },
    { after: 800, emit: (ctx) => usageStep(ctx, { in: 16800, out: 3452, cache: 0, total: 20252 }, "usage") },
    { after: 900, emit: () => [log("file_edit", target, "✓ typecheck lolos — 0 error")] },
    {
      after: 600,
      emit: (ctx) => [
        {
          type: "FINAL",
          result: {
            summary:
              "Refactor selesai: token dipindah ke httponly cookie, 3 file berubah, typecheck lolos.",
            target,
            worktree: `choros/run-38`,
            isolated: true,
            filesChanged: 3,
            added: 64,
            removed: 18,
            tokens: ctx.usage.total,
            duration: "4m 12s",
          },
          events: [
            ev("output", target, "output final diterima"),
            ev(
              "status",
              "choros",
              `✓ tugas selesai lewat ${target} — ${fmt(ctx.usage.total)} tok · 4m 12s`,
            ),
          ],
        },
      ],
    },
  ];
}

function haltedSteps(): Step[] {
  return [
    {
      after: 1200,
      emit: () => [
        {
          type: "TARGET_FAILED",
          attempt: { index: 1, target: T1, outcome: "failed", reason: "429 / limit", note: "jatuh ke target berikut" },
          event: ev("limit", "antigravity", "429 rate limited — cascading"),
        },
      ],
    },
    {
      after: 800,
      emit: () => [
        {
          type: "TARGET_FAILED",
          attempt: {
            index: 2,
            target: "opencode-groq/llama-3.3-70b",
            outcome: "failed",
            reason: "exhausted",
            note: "cooldown 00:41:12",
          },
          event: ev("limit", "opencode-groq", "exhausted — cooldown 00:41:12"),
        },
      ],
    },
    {
      after: 900,
      emit: () => [
        {
          type: "TARGET_FAILED",
          attempt: { index: 3, target: T3, outcome: "failed", reason: "429 / limit", note: "target terakhir" },
          event: ev("limit", T3, "429 rate limited"),
        },
      ],
    },
    {
      after: 700,
      emit: (ctx) => [
        {
          type: "CHAIN_EXHAUSTED",
          halt: {
            reason: "chain_exhausted",
            message: `Semua target ${ctx.request.category} habis — plan tersimpan.`,
            resetIn: "02:14:33",
          },
          event: ev("status", "choros", `rantai ${ctx.request.category} habis — run dihentikan dengan rapi`),
        },
      ],
    },
  ];
}

function crashSteps(): Step[] {
  return [
    {
      after: 1400,
      emit: () => [
        {
          type: "FATAL",
          failure: {
            message: "harness crash — adapter keluar dengan kode 137",
            stack: [
              "Traceback (most recent call last):",
              '  File "app/adapters/antigravity.py", line 118, in run',
              "    async for chunk in proc.stdout:",
              '  File "asyncio/streams.py", line 761, in __anext__',
              "    val = await self.readline()",
              "BrokenPipeError: [Errno 32] Broken pipe",
              "  → proses anak dibunuh OOM killer (exit 137)",
            ],
          },
          event: ev("error", "antigravity", "✗ harness crash — adapter keluar dengan kode 137"),
        },
      ],
    },
  ];
}

function script(scenario: ScenarioId): Step[] {
  switch (scenario) {
    case "lancar":
      return [...opening(T1), ...finishSteps(T1)];
    case "tanya":
      return [...opening(T1), ...questionStep(T1), ...finishSteps(T1)];
    case "cascade":
      return [...opening(T1), ...cascadeSteps(), ...finishSteps(T3)];
    case "habis":
      return [...opening(T1), ...haltedSteps()];
    case "crash":
      return [...opening(T1), ...crashSteps()];
    case "cascade_tanya":
    default:
      return [...opening(T1), ...cascadeSteps(), ...questionStep(T3), ...finishSteps(T3)];
  }
}

export interface MockDaemonOptions {
  /** Skenario yang diputar saat submit berikutnya. */
  getScenario: () => ScenarioId;
}

export function createMockDaemon(sink: DaemonSink, opts: MockDaemonOptions): DaemonClient {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let steps: Step[] = [];
  let cursor = 0;
  let ctx: Ctx | null = null;
  let live = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const pump = () => {
    if (!live || !ctx) return;
    const step = steps[cursor];
    if (!step) {
      live = false;
      return;
    }
    cursor += 1;
    if (step.emit === null) {
      // langkah penahan: tunggu reply()/defer()
      return;
    }
    const emit = step.emit;
    timer = setTimeout(() => {
      if (!live || !ctx) return;
      for (const e of emit(ctx)) sink(e);
      pump();
    }, step.after);
  };

  const resume = () => {
    if (!live) return;
    pump();
  };

  return {
    submit(request, _runId) {
      clear();
      ctx = { request, usage: { in: 0, out: 0, cache: 0, total: 0 } };
      steps = script(opts.getScenario());
      cursor = 0;
      live = true;
      pump();
    },
    reply(text) {
      sink({ type: "REPLY", text, ts: nowTs() });
      resume();
    },
    defer() {
      sink({ type: "DEFER", ts: nowTs() });
      resume();
    },
    cancel() {
      clear();
      live = false;
      sink({ type: "CANCEL", ts: nowTs() });
    },
    dispose() {
      clear();
      live = false;
    },
  };
}
