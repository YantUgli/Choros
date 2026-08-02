import { describe, expect, it } from "vitest";
import { toRouteChains, type WireRoutingRule } from "./routingApi";
import type { WireAgentFull } from "./agentApi";
import type { QuotaRow } from "./quotaApi";

describe("routingApi", () => {
  describe("toRouteChains", () => {
    const agents: WireAgentFull[] = [
      { id: 1, name: "Agent 1", adapter_type: "a", base_url: null, default_model: "def", config: {}, is_active: true },
      { id: 2, name: "Agent 2", adapter_type: "b", base_url: null, default_model: null, config: {}, is_active: true },
    ];
    const quota: QuotaRow[] = [
      { key: "1::def", agentId: 1, agent: "Agent 1", model: "def", used: 10, windowType: "daily", windowEnd: null, cooldownLeft: null, exhausted: true },
    ];

    it("mengurutkan menaik menurut priority", () => {
      const rules: WireRoutingRule[] = [
        { id: 1, category: "cat", agent_id: 1, model: null, priority: 20 },
        { id: 2, category: "cat", agent_id: 2, model: null, priority: 10 },
      ];
      const chains = toRouteChains(rules, agents, quota);
      
      expect(chains["cat"]).toHaveLength(2);
      expect(chains["cat"]![0]!.id).toBe(2);
      expect(chains["cat"]![1]!.id).toBe(1);
    });

    it("label gabungan (cermin router.py:57-59)", () => {
      const rules: WireRoutingRule[] = [
        { id: 1, category: "c1", agent_id: 1, model: null, priority: 1 }, // akan fallback ke "def" -> Agent 1/def
        { id: 2, category: "c2", agent_id: 2, model: null, priority: 1 }, // model null -> Agent 2
      ];
      const chains = toRouteChains(rules, agents, quota);
      
      expect(chains["c1"]![0]!.label).toBe("Agent 1/def");
      expect(chains["c2"]![0]!.label).toBe("Agent 2");
    });

    it("quotaExhausted memetakan ke QuotaRow", () => {
      const rules: WireRoutingRule[] = [
        { id: 1, category: "c1", agent_id: 1, model: null, priority: 1 }, // exhausted
        { id: 2, category: "c1", agent_id: 2, model: null, priority: 2 }, // tidak ada di quota
      ];
      const chains = toRouteChains(rules, agents, quota);
      
      expect(chains["c1"]![0]!.quotaExhausted).toBe(true);
      expect(chains["c1"]![1]!.quotaExhausted).toBe(false);
    });

    it("mengabaikan agent yatim tanpa menghilangkan rule lain", () => {
      const rules: WireRoutingRule[] = [
        { id: 1, category: "c1", agent_id: 99, model: null, priority: 1 },
        { id: 2, category: "c1", agent_id: 1, model: null, priority: 2 },
      ];
      const chains = toRouteChains(rules, agents, quota);
      
      expect(chains["c1"]).toHaveLength(1);
      expect(chains["c1"]![0]!.id).toBe(2);
    });
  });
});
