import { apiGet, apiSend } from "./api";

export interface WireAgentFull {
  id: number;
  name: string;
  adapter_type: string;
  base_url: string | null;
  default_model: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
}

export interface WireAdapterInfo {
  adapter_type: string;
  has_hands: boolean;
  subscription_bound: boolean;
}

export interface AgentRow {
  id: number;
  name: string;
  adapter: string;
  model: string;
  active: boolean;
}

export function toAgentRows(agents: WireAgentFull[]): AgentRow[] {
  return [...agents]
    .sort((a, b) => a.id - b.id)
    .map((a) => ({
      id: a.id,
      name: a.name,
      adapter: a.adapter_type,
      model: a.default_model || "—",
      active: a.is_active,
    }));
}

export async function fetchAgents(): Promise<WireAgentFull[]> {
  return apiGet<WireAgentFull[]>("/api/agents");
}

export async function createAgent(body: Omit<WireAgentFull, "id">): Promise<WireAgentFull> {
  const res = await apiSend<WireAgentFull>("POST", "/api/agents", body);
  return res!;
}

export async function updateAgent(id: number, body: Omit<WireAgentFull, "id">): Promise<WireAgentFull> {
  const res = await apiSend<WireAgentFull>("PUT", `/api/agents/${id}`, body);
  return res!;
}

export async function deleteAgent(id: number): Promise<void> {
  await apiSend("DELETE", `/api/agents/${id}`);
}

export async function fetchAdapters(): Promise<WireAdapterInfo[]> {
  return apiGet<WireAdapterInfo[]>("/api/agents/adapters");
}
