import { apiGet, apiSend } from "./api";
import type { WireAgent } from "./taskApi";

export interface WireQuotaWindow {
  id: number;
  agent_id: number;
  model: string | null;
  window_type: string | null;
  window_start: string | null;
  window_end: string | null;
  tokens_used: number;
  is_exhausted: boolean;
}

export interface WireUsageRow {
  agent_id: number;
  agent: string;
  model: string | null;
  runs: number;
  tokens: number;
  rate_limited: number;
}

export interface QuotaRow {
  key: string;
  agentId: number;
  agent: string;
  model: string | null;
  used: number;
  windowType: string | null;
  windowEnd: string | null;
  /** detik tersisa sampai cooldown lepas; null = tidak sedang cooldown */
  cooldownLeft: number | null;
  exhausted: boolean;
}

/** Window dianggap hidup persis seperti app/orchestrator/quota.py:_get_*_window. */
function aktif(w: WireQuotaWindow, nowMs: number): boolean {
  return w.window_end === null || Date.parse(w.window_end) > nowMs;
}

/**
 * Gabungkan baris cooldown + baris token per (agent, model).
 *
 * Cerminan `is_exhausted()` di backend: cooldown aktif menang duluan, baru
 * window token yang `is_exhausted`. Kalau dua logika ini berpisah, klaim
 * "satu sumber kebenaran" di kaki layar Quota jadi bohong lagi.
 */
export function toQuotaRows(
  windows: WireQuotaWindow[],
  agents: WireAgent[],
  nowMs: number,
): QuotaRow[] {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const grouped = new Map<string, { cooldown?: WireQuotaWindow; token?: WireQuotaWindow }>();

  for (const w of windows) {
    if (!aktif(w, nowMs)) continue;
    const key = `${w.agent_id}::${w.model ?? ""}`;
    const slot = grouped.get(key) ?? {};
    if (w.window_type === "cooldown") slot.cooldown = w;
    else slot.token = w;
    grouped.set(key, slot);
  }

  return [...grouped.entries()]
    .map(([key, { cooldown, token }]) => {
      const agentId = cooldown?.agent_id ?? token?.agent_id ?? 0;
      const agent = agentMap.get(agentId);
      const model = cooldown?.model ?? token?.model ?? null;
      const cooldownLeft =
        cooldown && cooldown.window_end
          ? Math.max(0, Math.round((Date.parse(cooldown.window_end) - nowMs) / 1000))
          : null;
      return {
        key,
        agentId,
        agent: agent?.name || `agent #${agentId}`,
        model: model ?? agent?.default_model ?? null,
        used: token?.tokens_used ?? 0,
        windowType: token?.window_type ?? null,
        windowEnd: token?.window_end ?? null,
        cooldownLeft,
        exhausted: cooldownLeft !== null || (token?.is_exhausted ?? false),
      };
    })
    .sort((a, b) => a.agent.localeCompare(b.agent) || (a.model ?? "").localeCompare(b.model ?? ""));
}

export interface ConsumptionRow {
  target: string;
  runs: number;
  tokens: number;
  limits: number;
}

export function toConsumptionRows(rows: WireUsageRow[]): ConsumptionRow[] {
  return rows.map((r) => ({
    target: `${r.agent} / ${r.model ?? "—"}`,
    runs: r.runs,
    tokens: r.tokens,
    limits: r.rate_limited,
  }));
}

export function formatCooldown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export async function fetchQuota(): Promise<{ rows: QuotaRow[]; consumption: ConsumptionRow[] }> {
  const [windows, agents, summary] = await Promise.all([
    apiGet<WireQuotaWindow[]>("/api/quota"),
    apiGet<WireAgent[]>("/api/agents"),
    apiGet<WireUsageRow[]>("/api/quota/summary?days=7"),
  ]);
  return {
    rows: toQuotaRows(windows, agents, Date.now()),
    consumption: toConsumptionRows(summary),
  };
}

export async function resetQuota(agentId: number, model: string | null): Promise<void> {
  await apiSend("POST", "/api/quota/reset", { agent_id: agentId, model });
}
