/**
 * Katalog model FALLBACK/placeholder. Sumber utama sekarang live dari CLI lewat
 * `GET /api/adapters/{type}/models` (lihat AgentEditorModal). Daftar di sini hanya
 * dipakai sebagai tampilan sementara saat query CLI belum balik, atau kalau
 * endpoint-nya sama sekali tak terjangkau.
 */
export const ADAPTERS: Record<string, string[]> = {
  claude_code: ["sonnet", "opus", "haiku", "default"],
  antigravity: ["default"],
  opencode: [
    "groq/llama-3.3-70b",
    "groq/llama-3.1-8b",
    "glm-5-free",
    "minimax-m3-free",
    "kimi-k2.5-free",
  ],
  openai_compatible: ["gpt-4o", "gpt-4o-mini"],
};
