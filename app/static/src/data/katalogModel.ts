/**
 * Katalog model statis yang dirawat tangan, bukan data runtime.
 * Daftar model yang tersedia untuk sebuah langganan memang tidak bisa ditanyakan ke
 * CLI mana pun secara andal.
 */
export const ADAPTERS: Record<string, string[]> = {
  claude_code: ["sonnet", "opus-4", "haiku"],
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
