import { describe, expect, it } from "vitest";
import {
  canCancel,
  consoleReducer,
  initialConsoleState,
  transition,
  type ConsoleEvent,
} from "./consoleMachine";
import type { ConsoleState, ConsoleStatus, RunRequest, StreamEvent } from "./types";
import { CANCELLABLE_STATUSES, TERMINAL_STATUSES } from "./types";

const ALL_STATUSES: ConsoleStatus[] = [
  "idle",
  "queued",
  "running",
  "waiting_for_input",
  "cascading",
  "done",
  "halted",
  "error",
];

const request: RunRequest = {
  prompt: "refactor modul auth supaya token disimpan di httponly cookie",
  category: "coding_complex",
  mode: "interaktif",
  projectPath: "C:\\project",
  qualityFloor: null,
  noIsolation: false,
};

const ev = (kind: StreamEvent["kind"], text: string, source = "choros"): StreamEvent => ({
  id: `t-${text}`,
  ts: "14:02:11",
  kind,
  source,
  text,
});

function run(state: ConsoleState, ...events: ConsoleEvent[]): ConsoleState {
  return events.reduce(consoleReducer, state);
}

const submit: ConsoleEvent = { type: "SUBMIT", request, runId: 38, ts: "14:02:10" };
const slotFree: ConsoleEvent = { type: "SLOT_FREE", target: "antigravity/default", ts: "14:02:11" };

/** idle → running, jalur paling umum. */
function running(): ConsoleState {
  return run(initialConsoleState, submit, slotFree);
}

describe("tabel transisi", () => {
  it("mengikuti jalur bahagia idle → queued → running → done", () => {
    expect(transition("idle", "SUBMIT")).toBe("queued");
    expect(transition("queued", "SLOT_FREE")).toBe("running");
    expect(transition("running", "FINAL")).toBe("done");
  });

  it("running → waiting_for_input → running lewat REPLY maupun DEFER", () => {
    expect(transition("running", "QUESTION")).toBe("waiting_for_input");
    expect(transition("waiting_for_input", "REPLY")).toBe("running");
    expect(transition("waiting_for_input", "DEFER")).toBe("running");
  });

  it("cascading berputar pada dirinya sendiri sampai target ketemu atau rantai habis", () => {
    expect(transition("running", "TARGET_FAILED")).toBe("cascading");
    expect(transition("cascading", "TARGET_FAILED")).toBe("cascading");
    expect(transition("cascading", "TARGET_SELECTED")).toBe("running");
    expect(transition("cascading", "CHAIN_EXHAUSTED")).toBe("halted");
  });

  it("hanya state cancellable yang bisa dibatalkan user → halted", () => {
    for (const s of ALL_STATUSES) {
      const allowed = CANCELLABLE_STATUSES.includes(s);
      expect(canCancel(s)).toBe(allowed);
      expect(transition(s, "CANCEL")).toBe(allowed ? "halted" : null);
    }
  });

  it("state akhir tidak bisa didorong oleh event daemon yang telat", () => {
    const lateEvents = ["SLOT_FREE", "QUESTION", "TARGET_FAILED", "TARGET_SELECTED", "FINAL", "FATAL"] as const;
    for (const s of TERMINAL_STATUSES) {
      for (const e of lateEvents) {
        expect(transition(s, e)).toBeNull();
      }
    }
  });

  it("state akhir hanya keluar lewat aksi user", () => {
    expect(transition("done", "RESET")).toBe("idle");
    expect(transition("halted", "RESUME")).toBe("queued");
    expect(transition("error", "RETRY")).toBe("queued");
    expect(transition("halted", "SUBMIT")).toBe("queued");
    // dan tidak ada jalan pintas antar-state-akhir
    expect(transition("halted", "RETRY")).toBeNull();
    expect(transition("done", "RESUME")).toBeNull();
  });

  it("rantai bisa berjalan sebelum ada target yang start", () => {
    // quality_floor tinggi / kuota habis membuat target dilewati saat masih queued
    expect(transition("queued", "TARGET_FAILED")).toBe("cascading");
    expect(transition("queued", "CHAIN_EXHAUSTED")).toBe("halted");
  });

  it("SUBMIT ditolak selama run masih dipegang daemon", () => {
    for (const s of ["queued", "running", "waiting_for_input", "cascading"] as ConsoleStatus[]) {
      expect(transition(s, "SUBMIT")).toBeNull();
    }
  });

  it("event tampilan tidak pernah menggeser status", () => {
    for (const s of ALL_STATUSES) {
      expect(transition(s, "TOGGLE_PAUSE")).toBe(s);
      expect(transition(s, "CLEAR_STREAM")).toBe(s);
      expect(transition(s, "LOG")).toBe(s);
      expect(transition(s, "JUMP_LATEST")).toBe(s);
    }
  });
});

describe("reducer — perilaku per state", () => {
  it("SUBMIT membersihkan sisa run sebelumnya", () => {
    const finished = run(running(), {
      type: "FINAL",
      result: {
        summary: "selesai",
        worktree: "choros/run-38",
        isolated: true,
        filesChanged: 3,
        added: 64,
        removed: 18,
        tokens: 23430,
        duration: "4m 12s",
      },
      events: [ev("status", "✓ selesai")],
    });
    expect(finished.status).toBe("done");

    const fresh = consoleReducer(finished, { ...submit, runId: 39 });
    expect(fresh.status).toBe("queued");
    expect(fresh.runId).toBe(39);
    expect(fresh.result).toBeNull();
    expect(fresh.attempts).toHaveLength(0);
    expect(fresh.stream).toHaveLength(1);
  });

  it("waiting_for_input mematikan auto-scroll dan mem-pin pertanyaan", () => {
    const q = ev("question", "simpan refresh-token juga?", "claude/sonnet");
    const s = consoleReducer(running(), { type: "QUESTION", event: q });
    expect(s.status).toBe("waiting_for_input");
    expect(s.autoScroll).toBe(false);
    expect(s.question).toEqual(q);
  });

  it("balasan menyalakan lagi auto-scroll dan melepas pin", () => {
    const waiting = consoleReducer(running(), {
      type: "QUESTION",
      event: ev("question", "?", "claude/sonnet"),
    });
    const s = consoleReducer(waiting, { type: "REPLY", text: "ya, keduanya", ts: "14:03:02" });
    expect(s.status).toBe("running");
    expect(s.question).toBeNull();
    expect(s.autoScroll).toBe(true);
    expect(s.stream.at(-1)?.text).toBe("› ya, keduanya");
  });

  it("jump-to-latest tidak melawan pin waiting_for_input", () => {
    const waiting = consoleReducer(running(), {
      type: "QUESTION",
      event: ev("question", "?", "claude/sonnet"),
    });
    expect(consoleReducer(waiting, { type: "JUMP_LATEST" }).autoScroll).toBe(false);

    const scrolled = consoleReducer(running(), { type: "SCROLL_AWAY" });
    expect(scrolled.autoScroll).toBe(false);
    expect(consoleReducer(scrolled, { type: "JUMP_LATEST" }).autoScroll).toBe(true);
  });

  it("cascade menumpuk percobaan berurut dan menandai target aktif", () => {
    let s = running();
    s = consoleReducer(s, {
      type: "TARGET_FAILED",
      attempt: { index: 1, target: "antigravity/default", outcome: "failed", reason: "429 / limit" },
      event: ev("limit", "429 rate limited — cascading ke target berikut", "antigravity"),
    });
    s = consoleReducer(s, {
      type: "TARGET_FAILED",
      attempt: { index: 2, target: "opencode-zen/glm-5-free", outcome: "skipped", reason: "< quality_floor" },
      event: ev("info", "dilewati — < quality_floor"),
    });
    s = consoleReducer(s, {
      type: "TARGET_SELECTED",
      target: "claude/sonnet",
      index: 3,
      event: ev("status", "resume di claude/sonnet — plan di-reuse"),
    });

    expect(s.status).toBe("running");
    expect(s.route).toBe("claude/sonnet");
    expect(s.planReused).toBe(true);
    expect(s.attempts.map((a) => a.outcome)).toEqual(["failed", "skipped", "running"]);
  });

  it("FINAL menutup percobaan aktif jadi ok", () => {
    let s = running();
    s = consoleReducer(s, {
      type: "TARGET_FAILED",
      attempt: { index: 1, target: "antigravity/default", outcome: "failed", reason: "429 / limit" },
      event: ev("limit", "429"),
    });
    s = consoleReducer(s, {
      type: "TARGET_SELECTED",
      target: "claude/sonnet",
      index: 2,
      event: ev("status", "resume"),
    });
    s = consoleReducer(s, {
      type: "FINAL",
      result: {
        summary: "ok",
        worktree: "choros/run-38",
        isolated: true,
        filesChanged: 3,
        added: 64,
        removed: 18,
        tokens: 23430,
        duration: "4m 12s",
      },
      events: [ev("status", "✓ tugas selesai")],
    });
    expect(s.attempts.map((a) => a.outcome)).toEqual(["failed", "ok"]);
  });

  it("halted karena rantai habis membawa countdown reset, bukan error", () => {
    let s = running();
    s = consoleReducer(s, {
      type: "TARGET_FAILED",
      attempt: { index: 1, target: "antigravity/default", outcome: "failed", reason: "429 / limit" },
      event: ev("limit", "429"),
    });
    s = consoleReducer(s, {
      type: "CHAIN_EXHAUSTED",
      halt: {
        reason: "chain_exhausted",
        message: "Semua target coding_complex habis — plan tersimpan.",
        resetIn: "02:14:33",
      },
      event: ev("status", "rantai coding_complex habis — run dihentikan dengan rapi"),
    });
    expect(s.status).toBe("halted");
    expect(s.failure).toBeNull();
    expect(s.halt?.resetIn).toBe("02:14:33");
  });

  it("CANCEL dari waiting_for_input menghasilkan halted beralasan dibatalkan", () => {
    const waiting = consoleReducer(running(), {
      type: "QUESTION",
      event: ev("question", "?", "claude/sonnet"),
    });
    const s = consoleReducer(waiting, { type: "CANCEL", ts: "14:02:40" });
    expect(s.status).toBe("halted");
    expect(s.halt?.reason).toBe("cancelled");
    expect(s.question).toBeNull();
  });

  it("FATAL membekukan stream — LOG setelahnya tidak menambah baris status", () => {
    const s = consoleReducer(running(), {
      type: "FATAL",
      failure: { message: "harness crash — adapter keluar dengan kode 137", stack: ["at spawn()", "at run()"] },
      event: ev("error", "✗ harness crash — adapter keluar dengan kode 137", "antigravity"),
    });
    expect(s.status).toBe("error");
    expect(s.failure?.stack).toHaveLength(2);

    const after = consoleReducer(s, { type: "SLOT_FREE", target: "claude/sonnet", ts: "14:02:30" });
    expect(after).toBe(s);
  });

  it("pause hanya menjeda tampilan — event tetap masuk stream", () => {
    const paused = consoleReducer(running(), { type: "TOGGLE_PAUSE" });
    expect(paused.paused).toBe(true);
    const s = consoleReducer(paused, { type: "LOG", event: ev("output", "menulis src/auth/session.ts…") });
    expect(s.paused).toBe(true);
    expect(s.stream.at(-1)?.text).toBe("menulis src/auth/session.ts…");
  });

  it("usage menetes ke ringkasan run", () => {
    const s = consoleReducer(running(), {
      type: "USAGE",
      usage: { in: 2800, out: 378, cache: 0, total: 3178 },
      event: ev("usage", "in=2,800 out=378 cache=0 total=3,178 tok", "usage"),
    });
    expect(s.usage.total).toBe(3178);
  });
});

describe("startedAt (dasar elapsed)", () => {
  it("null di initial, terisi epoch saat SUBMIT & ATTACH", () => {
    expect(initialConsoleState.startedAt).toBeNull();
    const s1 = consoleReducer(initialConsoleState, submit);
    expect(typeof s1.startedAt).toBe("number");
    expect(s1.startedAt).toBeGreaterThan(0);
    const s2 = consoleReducer(initialConsoleState, { type: "ATTACH", runId: 7, ts: "14:02:10" });
    expect(typeof s2.startedAt).toBe("number");
  });

  it("kembali null setelah RESET dari state terminal", () => {
    const done = run(running(), {
      type: "FINAL",
      result: { summary: "ok", worktree: "w", isolated: true, filesChanged: 0, added: 0, removed: 0, tokens: 0, duration: "1s" },
      events: [ev("status", "done")],
    });
    expect(done.startedAt).not.toBeNull();
    expect(consoleReducer(done, { type: "RESET" }).startedAt).toBeNull();
  });
});

describe("FOLLOW_UP", () => {
  const finished = run(running(), {
    type: "FINAL",
    result: { summary: "ok", worktree: "w", isolated: true, filesChanged: 0, added: 0, removed: 0, tokens: 0, duration: "1s" },
    events: [ev("status", "done")],
  });

  it("FOLLOW_UP dari done -> status === 'queued'", () => {
    expect(transition("done", "FOLLOW_UP")).toBe("queued");
  });

  it("FOLLOW_UP mempertahankan stream -> panjang stream bertambah 1, baris lama utuh", () => {
    const beforeLen = finished.stream.length;
    const next = consoleReducer(finished, { type: "FOLLOW_UP", text: "lanjutkan", ts: "14:05" });
    expect(next.stream).toHaveLength(beforeLen + 1);
    expect(next.stream.at(-1)?.text).toBe("› lanjutkan");
    expect(next.stream[0]).toEqual(finished.stream[0]);
  });

  it("FOLLOW_UP mengosongkan hasil & rantai -> result === null, attempts.length === 0, usage.total === 0", () => {
    const next = consoleReducer(finished, { type: "FOLLOW_UP", text: "lanjutkan", ts: "14:05" });
    expect(next.result).toBeNull();
    expect(next.attempts).toHaveLength(0);
    expect(next.usage.total).toBe(0);
  });

  it("FOLLOW_UP dari running / idle / halted / error -> state tidak berubah sama sekali", () => {
    for (const s of ["idle", "queued", "running", "waiting_for_input", "cascading", "halted", "error"] as ConsoleStatus[]) {
      expect(transition(s, "FOLLOW_UP")).toBeNull();
    }
  });

  it("SLOT_FREE setelah FOLLOW_UP -> menyeed attempt #1 lagi, route terisi target baru", () => {
    const next = consoleReducer(finished, { type: "FOLLOW_UP", text: "lanjut", ts: "14:05" });
    const started = consoleReducer(next, { type: "SLOT_FREE", target: "claude/sonnet", ts: "14:06" });
    expect(started.route).toBe("claude/sonnet");
    expect(started.attempts).toHaveLength(1);
    expect(started.attempts[0]?.index).toBe(1);
    expect(started.attempts[0]?.target).toBe("claude/sonnet");
  });
});
