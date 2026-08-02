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

let cachedAgents: WireAgent[] | null = null;

export async function fetchAttempts(taskId: number, base = ""): Promise<AttemptRow[]> {
  if (!cachedAgents) {
    const res = await fetch(`${base}/api/agents`);
    // Kegagalan tidak di-cache: panggilan berikutnya harus mencoba lagi, kalau
    // tidak satu kegagalan sesaat mengunci semua nama agent jadi "agent #N".
    if (res.ok) cachedAgents = (await res.json()) as WireAgent[];
  }
  const res = await fetch(`${base}/api/tasks/${taskId}/logs`);
  if (!res.ok) throw new Error("Gagal mengambil log");
  const logs = (await res.json()) as WireTaskLog[];
  return toAttemptRows(logs, cachedAgents ?? []);
}
