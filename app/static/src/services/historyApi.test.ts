import { describe, expect, it } from "vitest";
import { toHistoryItems } from "./historyApi";
import type { WireTaskOut } from "./sseDaemon";

describe("historyApi", () => {
  describe("toHistoryItems", () => {
    it("mempertahankan urutan dan menangani finished_at null", () => {
      const tasks: WireTaskOut[] = [
        {
          id: 2,
          prompt: "p2",
          category: "c",
          mode: "autonomous",
          status: "ok",
          project_path: null,
          workspace_path: null,
          final_output: null,
          created_at: "2024-01-01T00:00:00Z",
          finished_at: null,
        },
        {
          id: 1,
          prompt: "p1",
          category: "c",
          mode: "interactive",
          status: "error",
          project_path: null,
          workspace_path: null,
          final_output: null,
          created_at: "2023-01-01T00:00:00Z",
          finished_at: "2023-01-01T01:00:00Z",
        },
      ];
      
      const items = toHistoryItems(tasks);
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe(2);
      expect(items[1]!.id).toBe(1);
      expect(items[0]!.createdAt).toBe("2024-01-01T00:00:00Z");
      expect(items[1]!.status).toBe("error");
    });
  });
});
