import { apiGet } from "./api";

export interface ClaudeUsagePeriod {
  pct_used: number;
  resets_at: string;
}

export interface ClaudeUsage {
  session: ClaudeUsagePeriod | null;
  week: ClaudeUsagePeriod | null;
  error?: string;
  raw?: string;
}

export async function fetchClaudeUsage(): Promise<ClaudeUsage> {
  return apiGet<ClaudeUsage>("/api/quota/claude-usage");
}
