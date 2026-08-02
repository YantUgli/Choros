import { apiGet, apiSend } from "./api";
import type { WireAgentFull } from "./agentApi";
import type { QuotaRow } from "./quotaApi";

export interface WireRoutingRule {
  id: number;
  category: string;
  agent_id: number;
  model: string | null;
  priority: number;
}

export interface RouteTarget {
  id: number;
  agentId: number;
  agent: string;
  adapter: string;
  model: string | null;
  originalModel: string | null;
  /** label gabungan, mencerminkan Target.label di app/orchestrator/router.py */
  label: string;
  quotaExhausted: boolean;
  quotaLabel: string;
}

export function toRouteChains(
  rules: WireRoutingRule[],
  agents: WireAgentFull[],
  quota: QuotaRow[],
): Record<string, RouteTarget[]> {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const quotaMap = new Map(quota.map((q) => [q.key, q]));

  const chains: Record<string, RouteTarget[]> = {};

  // Kelompokkan dan urutkan berdasarkan prioritas menaik
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (!chains[rule.category]) {
      chains[rule.category] = [];
    }

    const agent = agentMap.get(rule.agent_id);
    if (!agent) continue; // Yatim

    const model = rule.model ?? agent.default_model;
    const label = model ? `${agent.name}/${model}` : agent.name;
    // Window kuota selalu tersimpan dengan model TERESOLUSI:
    // router.py:85 -> Target.model = rule.model or agent.default_model, lalu
    // runner.py:408/599/617 meneruskan target.model ke seluruh fungsi quota.*.
    // Memakai rule.model mentah di sini membuat rule yang mewarisi model
    // (model: null) tidak pernah menemukan window kuotanya sendiri.
    const qKey = `${agent.id}::${model ?? ""}`;
    const q = quotaMap.get(qKey);

    let quotaLabel = "—";
    if (q) {
      quotaLabel = q.exhausted ? (q.cooldownEnd !== null ? "cooldown" : "limit") : "tersedia";
    }

    chains[rule.category]!.push({
      id: rule.id,
      agentId: rule.agent_id,
      agent: agent.name,
      adapter: agent.adapter_type,
      model,
      originalModel: rule.model,
      label,
      quotaExhausted: quotaLabel === "limit" || quotaLabel === "cooldown",
      quotaLabel,
    });
  }

  return chains;
}

import { fetchAgents } from "./agentApi";
import { fetchQuota } from "./quotaApi";

export async function fetchRoutingData(): Promise<Record<string, RouteTarget[]>> {
  const [rules, agents, quotaData] = await Promise.all([
    fetchRoutingRules(),
    fetchAgents(),
    fetchQuota(),
  ]);
  return toRouteChains(rules, agents, quotaData.rows);
}

export async function fetchRoutingRules(): Promise<WireRoutingRule[]> {
  return apiGet<WireRoutingRule[]>("/api/routing");
}

export async function fetchCategories(): Promise<{ value: string; label: string }[]> {
  return apiGet<{ value: string; label: string }[]>("/api/tasks/categories");
}

export async function createRoutingRule(body: Omit<WireRoutingRule, "id">): Promise<WireRoutingRule> {
  const res = await apiSend<WireRoutingRule>("POST", "/api/routing", body);
  return res!;
}

export async function updateRoutingRule(id: number, body: Omit<WireRoutingRule, "id">): Promise<WireRoutingRule> {
  const res = await apiSend<WireRoutingRule>("PUT", `/api/routing/${id}`, body);
  return res!;
}

export async function deleteRoutingRule(id: number): Promise<void> {
  await apiSend("DELETE", `/api/routing/${id}`);
}
