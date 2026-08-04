export interface WireTaskLog {
  id: number;
  agent_id: number;
  model: string | null;
  status: string | null;
  usage: Record<string, number> | null;
}

export interface WireAgent {
  id: number;
  name: string;
  default_model: string | null;
  adapter_type?: string;
  token_limit?: number | null;
}

export interface AttemptRow {
  index: number;
  agent: string;
  model: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
}

export function toAttemptRows(logs: WireTaskLog[], agents: WireAgent[]): AttemptRow[] {
  const agentMap = new Map<number, WireAgent>(agents.map((a) => [a.id, a]));
  return [...logs]
    .sort((a, b) => a.id - b.id)
    .map((log, i) => {
      const agent = agentMap.get(log.agent_id);
      const agentName = agent?.name || `agent #${log.agent_id}`;
      const model = log.model || agent?.default_model || "—";
      const tokensIn = log.usage?.input_tokens ?? 0;
      const tokensOut = log.usage?.output_tokens ?? 0;
      return {
        index: i + 1,
        agent: agentName,
        model,
        status: log.status ?? "—",
        tokensIn,
        tokensOut,
      };
    });
}

import { apiGet, apiSend, API_BASE } from "./api";

let cachedAgents: WireAgent[] | null = null;

export async function fetchAttempts(taskId: number, base = API_BASE): Promise<AttemptRow[]> {
  if (!cachedAgents) {
    try {
      cachedAgents = await apiGet<WireAgent[]>("/api/agents", base);
    } catch {
      // Kegagalan tidak di-cache: panggilan berikutnya harus mencoba lagi, kalau
      // tidak satu kegagalan sesaat mengunci semua nama agent jadi "agent #N".
    }
  }
  const logs = await apiGet<WireTaskLog[]>(`/api/tasks/${taskId}/logs`, base);
  return toAttemptRows(logs, cachedAgents ?? []);
}

export async function fetchDiff(taskId: number): Promise<{ diff?: string; status?: string }> {
  return apiGet<{ diff?: string; status?: string }>(`/api/tasks/${taskId}/diff`);
}

export async function mergeDiff(taskId: number): Promise<void> {
  await apiSend("POST", `/api/tasks/${taskId}/merge`);
}

export async function discardDiff(taskId: number): Promise<void> {
  await apiSend("POST", `/api/tasks/${taskId}/discard`);
}

export interface DiffLine {
  text: string;
  tone: "muted" | "add" | "del";
}

export function toDiffLines(raw: string): DiffLine[] {
  if (!raw.trim()) return [{ text: "Tidak ada perubahan", tone: "muted" }];
  
  return raw.split("\n").map(l => {
    if (l.startsWith("+++") || l.startsWith("---")) {
      return { text: l, tone: "muted" };
    }
    if (l.startsWith("+")) {
      return { text: l, tone: "add" };
    }
    if (l.startsWith("-")) {
      return { text: l, tone: "del" };
    }
    return { text: l, tone: "muted" };
  });
}
