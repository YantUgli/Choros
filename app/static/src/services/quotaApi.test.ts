import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCooldown, toConsumptionRows, toQuotaRows, fetchQuota, type WireQuotaWindow } from "./quotaApi";
import type { WireAgent } from "./taskApi";

describe("quotaApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("fetchQuota", () => {
    it("melempar error 401 saat belum login", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized")
      }));
      await expect(fetchQuota()).rejects.toThrow("401");
    });
  });

  describe("toQuotaRows", () => {
    const agents: WireAgent[] = [{ id: 1, name: "Agent1", default_model: "def-model" }];
    const nowMs = 1000000; // 1000 detik

    it("menggabungkan baris cooldown + token untuk (agent, model) yang sama", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: "m", window_type: "daily", window_start: "1970-01-01T00:00:00Z", window_end: "1970-01-01T00:20:00Z", tokens_used: 100, is_exhausted: false },
        { id: 2, agent_id: 1, model: "m", window_type: "cooldown", window_start: "1970-01-01T00:10:00Z", window_end: "1970-01-01T00:30:00Z", tokens_used: 0, is_exhausted: true },
      ];
      // window_end di 1200 dan 1800 detik. nowMs = 1000 detik.
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.used).toBe(100);
      expect(rows[0]!.cooldownEnd).toBe("1970-01-01T00:30:00Z");
    });

    it("membuang window dengan window_end di masa lalu", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: "m", window_type: "cooldown", window_start: "1970-01-01T00:00:00Z", window_end: "1970-01-01T00:10:00Z", tokens_used: 0, is_exhausted: true }, // end = 600s
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows).toHaveLength(0);
    });

    it("window_end === null dianggap aktif", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: "m", window_type: "daily", window_start: "1970-01-01T00:00:00Z", window_end: null, tokens_used: 100, is_exhausted: false },
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows).toHaveLength(1);
    });

    it("cooldown aktif -> exhausted === true walau token.is_exhausted === false", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: "m", window_type: "daily", window_start: null, window_end: "1970-01-01T00:30:00Z", tokens_used: 100, is_exhausted: false },
        { id: 2, agent_id: 1, model: "m", window_type: "cooldown", window_start: null, window_end: "1970-01-01T00:30:00Z", tokens_used: 0, is_exhausted: true },
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows[0]!.exhausted).toBe(true);
      expect(rows[0]!.cooldownEnd).toBe("1970-01-01T00:30:00Z");
    });

    it("token.is_exhausted === true tanpa cooldown -> exhausted === true, cooldownEnd === null", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: "m", window_type: "daily", window_start: null, window_end: "1970-01-01T00:30:00Z", tokens_used: 100, is_exhausted: true },
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows[0]!.exhausted).toBe(true);
      expect(rows[0]!.cooldownEnd).toBeNull();
    });

    it("agent_id tak dikenal -> agent #N, tidak melempar", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 99, model: "m", window_type: "daily", window_start: null, window_end: null, tokens_used: 100, is_exhausted: false },
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows[0]!.agent).toBe("agent #99");
    });

    it("model === null -> jatuh ke default_model agent", () => {
      const windows: WireQuotaWindow[] = [
        { id: 1, agent_id: 1, model: null, window_type: "daily", window_start: null, window_end: null, tokens_used: 100, is_exhausted: false },
      ];
      const rows = toQuotaRows(windows, agents, nowMs);
      expect(rows[0]!.model).toBe("def-model");
    });
  });

  describe("toConsumptionRows", () => {
    it("memetakan rate_limited -> limits", () => {
      const rows = toConsumptionRows([
        { agent_id: 1, agent: "Agent1", model: "m", runs: 5, tokens: 1000, rate_limited: 2 },
      ]);
      expect(rows[0]!.limits).toBe(2);
      expect(rows[0]!.target).toBe("Agent1 / m");
    });
  });

  describe("formatCooldown", () => {
    it("memformat detik jadi hh:mm:ss dengan padding", () => {
      expect(formatCooldown(8073)).toBe("02:14:33");
    });
  });
});
