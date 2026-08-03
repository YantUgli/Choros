import { describe, expect, it, vi } from "vitest";
import { toAttemptRows, fetchAttempts, type WireAgent, type WireTaskLog } from "./taskApi";

describe("toAttemptRows", () => {
  it("pemetaan dasar dengan semua field", () => {
    const logs: WireTaskLog[] = [
      { id: 10, agent_id: 1, model: "claude-3-sonnet", status: "ok", usage: { input_tokens: 100, output_tokens: 50 } },
    ];
    const agents: WireAgent[] = [
      { id: 1, name: "claude", default_model: "claude-3-haiku" },
    ];
    const rows = toAttemptRows(logs, agents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      index: 1,
      agent: "claude",
      model: "claude-3-sonnet",
      status: "ok",
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("model: null + default_model terisi -> jatuh ke default_model", () => {
    const logs: WireTaskLog[] = [{ id: 11, agent_id: 2, model: null, status: "ok", usage: null }];
    const agents: WireAgent[] = [{ id: 2, name: "antigravity", default_model: "glm-4" }];
    const rows = toAttemptRows(logs, agents);
    expect(rows[0]?.model).toBe("glm-4");
  });

  it("model: null + default_model kosong -> '—', bukan 'default'", () => {
    const logs: WireTaskLog[] = [{ id: 12, agent_id: 3, model: null, status: "failed", usage: null }];
    const agents: WireAgent[] = [{ id: 3, name: "local", default_model: null }];
    const rows = toAttemptRows(logs, agents);
    expect(rows[0]?.model).toBe("—");
  });

  it("agent_id tak dikenal -> 'agent #id'", () => {
    const logs: WireTaskLog[] = [{ id: 13, agent_id: 7, model: null, status: null, usage: null }];
    const rows = toAttemptRows(logs, []);
    expect(rows[0]?.agent).toBe("agent #7");
  });

  it("usage: null / kosong -> 0, bukan NaN", () => {
    const logs: WireTaskLog[] = [{ id: 14, agent_id: 1, model: "m", status: "ok", usage: null }];
    const rows = toAttemptRows(logs, [{ id: 1, name: "a", default_model: "m" }]);
    expect(rows[0]?.tokensIn).toBe(0);
    expect(rows[0]?.tokensOut).toBe(0);
  });

  it("diurut naik berdasarkan id, index 1-based", () => {
    const logs: WireTaskLog[] = [
      { id: 20, agent_id: 1, model: "m", status: "ok", usage: null },
      { id: 10, agent_id: 1, model: "m", status: "failed", usage: null },
      { id: 15, agent_id: 1, model: "m", status: "skipped", usage: null },
    ];
    const rows = toAttemptRows(logs, []);
    expect(rows.map(r => r.index)).toEqual([1, 2, 3]);
    expect(rows.map(r => r.status)).toEqual(["failed", "skipped", "ok"]);
  });

  it("/api/agents gagal lalu berhasil di panggilan kedua -> tidak cache kegagalan", async () => {
    let mockAgentId = 1;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/api/agents")) {
        if (mockAgentId === 1) {
          mockAgentId = 2; // trigger failure first
          return { ok: false };
        }
        return { ok: true, json: async () => [{ id: 1, name: "real-agent", default_model: "real-model" }] };
      }
      if (url.endsWith("/logs")) {
        return { ok: true, json: async () => [{ id: 10, agent_id: 1, model: null, status: "ok", usage: null }] };
      }
    });
    
    // First call: agents fails, but logs succeed. Should fallback to 'agent #1'.
    let rows = await fetchAttempts(1, "");
    expect(rows[0]?.agent).toBe("agent #1");

    // Second call: agents succeeds now. Should use 'real-agent'.
    rows = await fetchAttempts(2, "");
    expect(rows[0]?.agent).toBe("real-agent");
    
    vi.unstubAllGlobals();
  });
});

import { toDiffLines } from "./taskApi";

describe("toDiffLines", () => {
  it("+++/--- jadi muted", () => {
    const diff = "+++ b/src/auth.ts\n--- a/src/auth.ts";
    const lines = toDiffLines(diff);
    expect(lines).toEqual([
      { tone: "muted", text: "+++ b/src/auth.ts" },
      { tone: "muted", text: "--- a/src/auth.ts" }
    ]);
  });

  it("+/- jadi add/del", () => {
    const diff = "+ new line\n- old line";
    const lines = toDiffLines(diff);
    expect(lines).toEqual([
      { tone: "add", text: "+ new line" },
      { tone: "del", text: "- old line" }
    ]);
  });

  it("baris biasa jadi muted", () => {
    const diff = "  unchanged line";
    const lines = toDiffLines(diff);
    expect(lines).toEqual([
      { tone: "muted", text: "  unchanged line" }
    ]);
  });

  it("string kosong -> array dengan 1 baris 'Tidak ada perubahan'", () => {
    const lines = toDiffLines("   \n   ");
    expect(lines).toEqual([
      { tone: "muted", text: "Tidak ada perubahan" }
    ]);
  });
});
