import { describe, expect, it } from "vitest";
import { toAgentRows, type WireAgentFull } from "./agentApi";

describe("agentApi", () => {
  describe("toAgentRows", () => {
    it("memetakan dan mengurutkan agent", () => {
      const agents: WireAgentFull[] = [
        { id: 2, name: "Agent 2", adapter_type: "b", base_url: null, default_model: null, config: {}, is_active: false },
        { id: 1, name: "Agent 1", adapter_type: "a", base_url: "url", default_model: "mod", config: {}, is_active: true },
      ];
      const rows = toAgentRows(agents);
      
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).toBe(1);
      expect(rows[0]!.name).toBe("Agent 1");
      expect(rows[0]!.adapter).toBe("a");
      expect(rows[0]!.model).toBe("mod");
      expect(rows[0]!.active).toBe(true);
      
      expect(rows[1]!.id).toBe(2);
      expect(rows[1]!.model).toBe("—");
      expect(rows[1]!.active).toBe(false);
    });
  });
});
