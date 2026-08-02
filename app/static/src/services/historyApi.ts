import { apiGet, API_BASE } from "./api";
import { type AttemptRow, fetchAttempts } from "./taskApi";
import { toConsoleEvents, type WireEvent, type WireTaskOut } from "./sseDaemon";
import type { ConsoleEvent } from "../state/consoleMachine";

export interface HistoryItem {
  id: number;
  prompt: string;
  category: string;
  mode: string;
  status: string;
  createdAt: string | null;
}

export function toHistoryItems(tasks: WireTaskOut[]): HistoryItem[] {
  return tasks.map((t) => ({
    id: t.id,
    prompt: t.prompt,
    category: t.category,
    mode: t.mode,
    status: t.status,
    createdAt: t.created_at,
  }));
}

export async function fetchHistory(): Promise<HistoryItem[]> {
  const tasks = await apiGet<WireTaskOut[]>("/api/tasks?limit=50");
  return toHistoryItems(tasks);
}

/** Transkrip satu run historis: event → ConsoleEvent (mapper yang sama dengan SSE). */
export async function fetchTranscript(taskId: number): Promise<{
  events: ConsoleEvent[];
  attempts: AttemptRow[];
}> {
  const [eventsData, attempts] = await Promise.all([
    apiGet<WireEvent[]>(`/api/tasks/${taskId}/events`),
    fetchAttempts(taskId, API_BASE),
  ]);

  const events: ConsoleEvent[] = [];
  for (const w of eventsData) {
    // pass null for partialId to have a new LOG_DELTA for each partial (historis sudah terpisah di db)
    events.push(...toConsoleEvents(w, null));
  }

  return {
    events,
    attempts,
  };
}
