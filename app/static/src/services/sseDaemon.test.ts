import { describe, expect, it } from "vitest";
import { countdownTo, toConsoleEvents } from "./sseDaemon";
import { consoleReducer, initialConsoleState } from "../state/consoleMachine";
import type { ConsoleState } from "../state/types";

/** Bentuk kawat persis `app/events.py::Event.as_dict()`. */
const wire = (
  type: string,
  data: Record<string, unknown>,
  agent?: string,
  model?: string,
): Parameters<typeof toConsoleEvents>[0] =>
  ({ type, data, agent: agent ?? null, model: model ?? null, ts: 0 }) as Parameters<
    typeof toConsoleEvents
  >[0];

const feed = (state: ConsoleState, ...events: Parameters<typeof toConsoleEvents>[0][]): ConsoleState =>
  events.reduce(
    (s, w) => toConsoleEvents(w, "p-1").reduce(consoleReducer, s),
    state,
  );

const submitted = (): ConsoleState =>
  consoleReducer(initialConsoleState, {
    type: "SUBMIT",
    runId: 1,
    ts: "00:00:00",
    request: {
      prompt: "p",
      category: "coding_complex",
      mode: "interaktif",
      projectPath: "",
      qualityFloor: null,
      noIsolation: false,
    },
  });

describe("pemetaan event kawat → state machine", () => {
  it("status target_started menjalankan run dari queued", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan claude/sonnet (prioritas 10)", transition: "target_started", target: "claude/sonnet", attempt: 1 }, "claude", "sonnet"),
    );
    expect(s.status).toBe("running");
    expect(s.route).toBe("claude/sonnet");
  });

  it("target_failed → cascading, lalu target_started berikutnya → running", () => {
    let s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("status", { message: "a/x mentok kuota → lanjut", transition: "target_failed", target: "a/x", attempt: 1, reason: "429 / limit" }),
    );
    expect(s.status).toBe("cascading");

    s = feed(s, wire("status", { message: "menjalankan b/y", transition: "target_started", target: "b/y", attempt: 2 }));
    expect(s.status).toBe("running");
    expect(s.route).toBe("b/y");
    expect(s.planReused).toBe(true);
    expect(s.attempts.map((a) => [a.index, a.outcome])).toEqual([
      [1, "failed"],
      [2, "running"],
    ]);
  });

  it("target_skipped tercatat sebagai dilewati, bukan gagal", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("status", { message: "lewati b/y: di bawah batas mutu", transition: "target_skipped", target: "b/y", attempt: 2, reason: "< quality_floor" }),
    );
    expect(s.attempts.find((a) => a.index === 2)?.outcome).toBe("skipped");
  });

  it("chain_exhausted → halted dengan countdown reset", () => {
    const resetAt = new Date(Date.now() + 3661_000).toISOString();
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("status", { message: "a/x mentok", transition: "target_failed", target: "a/x", attempt: 1, reason: "429 / limit" }),
      wire("status", { message: "semua target habis", transition: "chain_exhausted", reset_at: resetAt }),
    );
    expect(s.status).toBe("halted");
    expect(s.failure).toBeNull();
    expect(s.halt?.resetIn).toMatch(/^01:01:0\d$/);
  });

  it("semua target dilewati sebelum ada yang start → halted, bukan queued selamanya", () => {
    // Kasus nyata: quality_floor 'frontier' membuat 8 target di bawahnya dilewati
    // tanpa satu pun sempat berjalan.
    let s = submitted();
    for (let i = 1; i <= 3; i += 1) {
      s = feed(
        s,
        wire("status", {
          message: `lewati t${i}: di bawah batas mutu`,
          transition: "target_skipped",
          target: `t${i}`,
          attempt: i,
          reason: "< quality_floor",
        }),
      );
    }
    expect(s.status).toBe("cascading");
    s = feed(s, wire("status", { message: "semua target habis", transition: "chain_exhausted" }));
    expect(s.status).toBe("halted");
    expect(s.attempts).toHaveLength(3);
    expect(s.attempts.every((a) => a.outcome === "skipped")).toBe(true);
  });

  it("status tanpa field transition tidak pernah menggeser state", () => {
    const before = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
    );
    const after = feed(
      before,
      wire("status", { message: "kategori 'coding_complex' → 4 target terdaftar" }),
      wire("status", { message: "fallback: mengulang dari artefak plan" }),
      wire("status", { message: "tugas selesai lewat a/x", transition: "done", target: "a/x" }),
    );
    expect(after.status).toBe("running");
    expect(after.stream.length).toBe(before.stream.length + 3);
  });

  it("question menahan run di waiting_for_input", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("question", { text: "pakai httponly?" }, "a", "x"),
    );
    expect(s.status).toBe("waiting_for_input");
    expect(s.autoScroll).toBe(false);
    expect(s.question?.text).toContain("pakai httponly?");
  });

  it("error cascade-trigger hanya jadi baris log — cascade diputuskan status", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("error", { kind: "rate_limit", message: "429 dari provider" }, "a", "x"),
    );
    expect(s.status).toBe("running");
    expect(s.attempts).toHaveLength(1);
    expect(s.stream.at(-1)?.kind).toBe("limit");
  });

  it("error non-cascade tidak diam-diam mematikan run", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("error", { kind: "parse", message: "output tidak terbaca" }, "a", "x"),
    );
    expect(s.status).toBe("running");
    expect(s.stream.at(-1)?.text).toContain("✗ [parse] output tidak terbaca");
  });

  it("output partial digabung jadi satu baris berjalan", () => {
    let s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
    );
    const before = s.stream.length;
    s = feed(
      s,
      wire("output", { text: "menulis ", partial: true }, "a", "x"),
      wire("output", { text: "src/auth", partial: true }, "a", "x"),
      wire("output", { text: "/token.ts", partial: true }, "a", "x"),
    );
    expect(s.stream.length).toBe(before + 1);
    expect(s.stream.at(-1)?.text).toBe("menulis src/auth/token.ts");
  });

  it("usage memakai nama field backend, termasuk cache read+write", () => {
    const s = feed(
      submitted(),
      wire("status", { message: "menjalankan a/x", transition: "target_started", target: "a/x", attempt: 1 }),
      wire("usage", {
        input_tokens: 2800,
        output_tokens: 378,
        cache_read_tokens: 100,
        cache_write_tokens: 50,
        total_tokens: 3178,
      }, "a", "x"),
    );
    expect(s.usage).toEqual({ in: 2800, out: 378, cache: 150, total: 3178 });
    expect(s.stream.at(-1)?.text).toContain("in=2,800 out=378 cache=150 total=3,178 tok");
  });

  it("thinking multi-baris jadi satu baris yang bisa dilipat", () => {
    const s = feed(
      submitted(),
      wire("thinking", { text: "baca modul\npetakan token\ntulis ulang" }, "a", "x"),
    );
    const last = s.stream.at(-1);
    expect(last?.text).toBe("thinking — 3 langkah");
    expect(last?.detail).toEqual(["baca modul", "petakan token", "tulis ulang"]);
  });

  it("file_edit dan tool_call dipetakan ke tag yang benar", () => {
    const s = feed(
      submitted(),
      wire("file_edit", { action: "edit", path: "src/a.ts" }, "a", "x"),
      wire("tool_call", { name: "list_dir", input: { path: "C:\\p" } }, "a", "x"),
    );
    expect(s.stream.at(-2)?.kind).toBe("file_edit");
    expect(s.stream.at(-2)?.text).toBe("✓ edit src/a.ts");
    expect(s.stream.at(-1)?.kind).toBe("tool_call");
    expect(s.stream.at(-1)?.text).toBe('list_dir {"path":"C:\\\\p"}');
  });

  it("eof tidak menghasilkan event apa pun (rekonsiliasi lewat GET task)", () => {
    expect(toConsoleEvents(wire("eof", {}), null)).toEqual([]);
  });
});

describe("countdownTo", () => {
  it("memformat sisa waktu HH:MM:SS", () => {
    const from = new Date("2026-08-02T10:00:00Z");
    expect(countdownTo("2026-08-02T12:14:33Z", from)).toBe("02:14:33");
  });
  it("tidak pernah negatif", () => {
    const from = new Date("2026-08-02T10:00:00Z");
    expect(countdownTo("2026-08-02T09:00:00Z", from)).toBe("00:00:00");
  });
  it("mengembalikan undefined untuk tanggal tak terbaca", () => {
    expect(countdownTo("bukan tanggal")).toBeUndefined();
  });
});
