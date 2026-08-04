import { apiGet } from "./api";

export interface GeminiBucket {
  bucket_id: string;
  display_name: string;
  window: string;
  pct_used: number;
  resets_at: string;
  description: string;
}

export interface GeminiGroup {
  display_name: string;
  description: string;
  buckets: GeminiBucket[];
}

export interface GeminiUsage {
  groups?: GeminiGroup[];
  error?: string;
  detail?: string;
  status?: number;
}

export async function fetchGeminiUsage(): Promise<GeminiUsage> {
  return apiGet<GeminiUsage>("/api/quota/gemini-usage");
}
