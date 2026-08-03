import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDaemon } from "./mockDaemon";
import type { ConsoleEvent } from "../state/consoleMachine";

describe("mockDaemon", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const request = {
    prompt: "test",
    category: "coding_complex" as const,
    mode: "interaktif" as const,
    projectPath: "path",
    qualityFloor: null,
    noIsolation: false,
  };

  it("submit skenario lancar memutar skrip sampai habis", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "lancar" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(120_000);
    
    expect(events.at(-1)?.type).toBe("FINAL");
  });

  it("followUp setelah FINAL menghidupkan skrip lagi", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "lancar" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(120_000);
    
    expect(events.at(-1)?.type).toBe("FINAL");
    events.length = 0; // clear

    daemon.followUp("lanjut");
    expect(events[0]?.type).toBe("FOLLOW_UP");

    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.length).toBeGreaterThan(1);
    expect(events.some((e) => e.type === "SLOT_FREE")).toBe(true);
    expect(events.at(-1)?.type).toBe("FINAL");
  });

  it("followUp menolkan akumulator usage", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "lancar" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(120_000);
    
    const usage1 = events.find((e) => e.type === "USAGE") as Extract<ConsoleEvent, { type: "USAGE" }>;
    events.length = 0;

    daemon.followUp("lanjut");
    await vi.advanceTimersByTimeAsync(120_000);
    
    const usage2 = events.find((e) => e.type === "USAGE") as Extract<ConsoleEvent, { type: "USAGE" }>;
    
    expect(usage2.usage.total).toBe(usage1.usage.total);
    expect(usage2.usage.total).toBeLessThanOrEqual(usage1.usage.total);
  });

  it("followUp pada skenario tanya (berhenti di langkah penahan)", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "tanya" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(120_000); // halts at QUESTION
    
    expect(events.at(-1)?.type).toBe("QUESTION");
    events.length = 0;
    
    daemon.followUp("lanjut"); 
    await vi.advanceTimersByTimeAsync(120_000);
    
    expect(events.at(-1)?.type).toBe("QUESTION");
  });

  it("reply pada skenario tanya masih melanjutkan skrip", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "tanya" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.at(-1)?.type).toBe("QUESTION");
    
    events.length = 0;
    daemon.reply("ya");
    expect(events[0]?.type).toBe("REPLY");
    
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.at(-1)?.type).toBe("FINAL");
  });

  it("cancel menghentikan pemancaran", async () => {
    const events: ConsoleEvent[] = [];
    const daemon = createMockDaemon((e) => events.push(e), { getScenario: () => "lancar" });
    
    daemon.submit(request, 1);
    await vi.advanceTimersByTimeAsync(1_000);
    
    events.length = 0;
    daemon.cancel();
    expect(events[0]?.type).toBe("CANCEL");
    
    events.length = 0;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(events.length).toBe(0); 
  });
});
