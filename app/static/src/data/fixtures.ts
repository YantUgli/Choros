/**
 * Data contoh — angka & teks diambil apa adanya dari file design hi-fi.
 * Semua yang di sini kelak datang dari daemon; bentuknya sengaja dibuat
 * seperti respons API supaya penggantian jadi tukar sumber, bukan tukar UI.
 */

import type { BadgeTone } from "../components/ds";
import type { DotStatus } from "../components/ds";
import type { TaskCategory } from "../state/types";

/** Model per adapter — model default WAJIB dipilih dari daftar ini, bukan diketik. */
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

export const ADAPTER_LIST = Object.keys(ADAPTERS);

/** Pohon folder untuk modal Browse… (mock filesystem). */
export const FS: Record<string, string[]> = {
  "C:\\": ["project", "Users", "Windows", "temp"],
  "C:\\project": ["src", "Assets", "api", "infra", "web"],
  "C:\\project\\src": ["auth", "components", "lib", "routes"],
  "C:\\project\\src\\auth": [],
  "C:\\project\\src\\components": [],
  "C:\\project\\src\\lib": [],
  "C:\\project\\src\\routes": [],
  "C:\\project\\Assets": ["portpilot-notes"],
  "C:\\project\\Assets\\portpilot-notes": [],
  "C:\\project\\api": ["handlers", "db"],
  "C:\\project\\api\\handlers": [],
  "C:\\project\\api\\db": [],
  "C:\\project\\infra": [],
  "C:\\project\\web": ["public", "styles"],
  "C:\\project\\web\\public": [],
  "C:\\project\\web\\styles": [],
  "C:\\Users": ["dev"],
  "C:\\Users\\dev": ["repos"],
  "C:\\Users\\dev\\repos": [],
  "C:\\Windows": [],
  "C:\\temp": [],
};

export const CATEGORIES: TaskCategory[] = [
  "coding_complex",
  "coding_quick",
  "text_long",
  "text_quick",
];

// --- Riwayat sesi ------------------------------------------------------------

export type TranscriptMessage =
  | { kind: "user"; text: string }
  | { kind: "agent"; src: string; text: string }
  | { kind: "switch"; from: string; reason: string; to: string }
  | { kind: "note"; text: string };

export interface ChainLink {
  label: string;
  tone: BadgeTone;
  reason?: string;
}

export interface Session {
  id: number;
  prompt: string;
  category: TaskCategory;
  mode: string;
  status: string;
  statusTone: BadgeTone;
  dot: DotStatus;
  chain: ChainLink[];
  messages: TranscriptMessage[];
}

export const SESSIONS: Session[] = [
  {
    id: 7,
    prompt: "coba akses folder assets ada apa saja di situ?",
    category: "coding_complex",
    mode: "interactive",
    status: "ok",
    statusTone: "ok",
    dot: "ok",
    chain: [{ label: "antigravity/default", tone: "ok" }],
    messages: [
      { kind: "user", text: "coba akses folder assets ada apa saja di situ?" },
      { kind: "agent", src: "antigravity/default", text: "list_dir Assets → 1 subfolder: portpilot-notes" },
      {
        kind: "agent",
        src: "antigravity/default",
        text: "Di folder Assets hanya ada portpilot-notes. Periksa lebih dalam?",
      },
    ],
  },
  {
    id: 6,
    prompt: "ada project apa saja di folder ini?",
    category: "coding_complex",
    mode: "interactive",
    status: "ok",
    statusTone: "ok",
    dot: "ok",
    chain: [
      { label: "antigravity/default", tone: "limit", reason: "429" },
      { label: "claude/sonnet", tone: "ok" },
    ],
    messages: [
      { kind: "user", text: "ada project apa saja di folder ini?" },
      { kind: "agent", src: "antigravity/default", text: "membaca root project…" },
      { kind: "switch", from: "antigravity/default", reason: "429 rate limited", to: "claude/sonnet" },
      { kind: "agent", src: "claude/sonnet", text: "Ada 3 project di C:\\project — web, api, infra." },
    ],
  },
  {
    id: 5,
    prompt: "kenapa saya ada di folder c/project?",
    category: "coding_complex",
    mode: "interactive",
    status: "ok",
    statusTone: "ok",
    dot: "ok",
    chain: [{ label: "antigravity/default", tone: "ok" }],
    messages: [
      { kind: "user", text: "kenapa saya ada di folder c/project?" },
      {
        kind: "agent",
        src: "antigravity/default",
        text: "cwd = C:\\project — working dir default choros untuk sesi ini.",
      },
    ],
  },
  {
    id: 4,
    prompt: "generate migrasi db penuh untuk skema baru",
    category: "coding_complex",
    mode: "autonomous",
    status: "halted",
    statusTone: "neutral",
    dot: "idle",
    chain: [
      { label: "antigravity/default", tone: "limit", reason: "429" },
      { label: "opencode-groq", tone: "limit", reason: "exhausted" },
      { label: "claude/sonnet", tone: "limit", reason: "429" },
    ],
    messages: [
      { kind: "user", text: "generate migrasi db penuh untuk skema baru" },
      { kind: "agent", src: "antigravity/default", text: "menyusun rencana migrasi…" },
      {
        kind: "switch",
        from: "antigravity/default",
        reason: "429 rate limited",
        to: "opencode-groq/llama-3.3-70b",
      },
      { kind: "agent", src: "opencode-groq/llama-3.3-70b", text: "mulai menulis migrasi…" },
      { kind: "switch", from: "opencode-groq/llama-3.3-70b", reason: "exhausted", to: "claude/sonnet" },
      { kind: "switch", from: "claude/sonnet", reason: "429 rate limited", to: "—" },
      {
        kind: "note",
        text: "rantai coding_complex habis — plan tersimpan, resume saat reset 02:14:33",
      },
    ],
  },
];

// --- Routing -----------------------------------------------------------------

export interface RouteTarget {
  id: string;
  target: string;
  agent: string;
  adapter: string;
  model: string;
  /** null = "floor —" */
  floor: number | null;
  quotaStatus: DotStatus;
  quotaLabel: string;
}

export const ROUTE_CHAINS: Record<TaskCategory, RouteTarget[]> = {
  coding_complex: [
    {
      id: "rt-1",
      target: "antigravity/default",
      agent: "antigravity",
      adapter: "antigravity",
      model: "default",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia · 68,206 tok",
    },
    {
      id: "rt-2",
      target: "opencode-zen/glm-5-free",
      agent: "opencode-zen",
      adapter: "opencode",
      model: "glm-5-free",
      floor: 6,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
    {
      id: "rt-3",
      target: "opencode-groq/llama-3.3-70b",
      agent: "opencode-groq",
      adapter: "opencode",
      model: "groq/llama-3.3-70b",
      floor: 5,
      quotaStatus: "limit",
      quotaLabel: "cooldown 00:41:12",
    },
    {
      id: "rt-4",
      target: "claude/sonnet",
      agent: "claude",
      adapter: "claude_code",
      model: "sonnet",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "jatah terakhir · tersedia",
    },
  ],
  coding_quick: [
    {
      id: "rq-1",
      target: "opencode-zen/kimi-k2.5-free",
      agent: "opencode-zen",
      adapter: "opencode",
      model: "kimi-k2.5-free",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
    {
      id: "rq-2",
      target: "antigravity/default",
      agent: "antigravity",
      adapter: "antigravity",
      model: "default",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia · 68,206 tok",
    },
    {
      id: "rq-3",
      target: "claude/haiku",
      agent: "claude",
      adapter: "claude_code",
      model: "haiku",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
  ],
  text_long: [
    {
      id: "tl-1",
      target: "claude/sonnet",
      agent: "claude",
      adapter: "claude_code",
      model: "sonnet",
      floor: null,
      quotaStatus: "limit",
      quotaLabel: "cooldown 02:14:33",
    },
    {
      id: "tl-2",
      target: "opencode-zen/minimax-m3-free",
      agent: "opencode-zen",
      adapter: "opencode",
      model: "minimax-m3-free",
      floor: 5,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
  ],
  text_quick: [
    {
      id: "tq-1",
      target: "opencode-groq/groq/llama-3.1-8b",
      agent: "opencode-groq",
      adapter: "opencode",
      model: "groq/llama-3.1-8b",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
    {
      id: "tq-2",
      target: "claude/haiku",
      agent: "claude",
      adapter: "claude_code",
      model: "haiku",
      floor: null,
      quotaStatus: "ok",
      quotaLabel: "tersedia",
    },
  ],
};

// --- Quota -------------------------------------------------------------------

export interface QuotaWindow {
  key: string;
  agent: string;
  model: string;
  used: number;
  max: number;
  /** null = tidak ada batas tercatat */
  badge: { tone: BadgeTone; text: string };
  cooldown?: string;
}

export const QUOTA_WINDOWS: QuotaWindow[] = [
  {
    key: "antigravity",
    agent: "antigravity",
    model: "—",
    used: 68206,
    max: 200000,
    badge: { tone: "ok", text: "tersedia" },
  },
  {
    key: "claude-sonnet",
    agent: "claude",
    model: "sonnet",
    used: 182400,
    max: 200000,
    badge: { tone: "limit", text: "429 · cooldown 02:14:33" },
    cooldown: "02:14:33",
  },
  {
    key: "groq-llama",
    agent: "opencode-groq",
    model: "llama-3.3-70b",
    used: 100000,
    max: 100000,
    badge: { tone: "limit", text: "exhausted · 00:41:12" },
    cooldown: "00:41:12",
  },
];

export interface ConsumptionRow {
  target: string;
  runs: number;
  tokens: number;
  limits: number;
}

export const CONSUMPTION_7D: ConsumptionRow[] = [
  { target: "antigravity / —", runs: 4, tokens: 68206, limits: 0 },
  { target: "claude / sonnet", runs: 11, tokens: 412908, limits: 2 },
  { target: "opencode-groq / llama-3.3-70b", runs: 7, tokens: 96114, limits: 3 },
];

// --- Agents ------------------------------------------------------------------

export interface AgentRow {
  name: string;
  adapter: string;
  model: string;
  active: boolean;
}

export const AGENTS: AgentRow[] = [
  { name: "claude", adapter: "claude_code", model: "sonnet", active: true },
  { name: "antigravity", adapter: "antigravity", model: "—", active: true },
  { name: "opencode-groq", adapter: "opencode", model: "groq/llama-3.3-70b", active: true },
];

// --- Plan artifact -----------------------------------------------------------

export const PLAN_STEPS = [
  "1. baca modul auth",
  "2. petakan pemakaian token",
  "3. pindah ke httponly cookie",
  "4. jalankan typecheck",
];

// --- Diff --------------------------------------------------------------------

export interface DiffLine {
  tone: "muted" | "add" | "del";
  text: string;
}

export const DIFF_FILE = "src/auth/token.ts · +18 −4";

export const DIFF_LINES: DiffLine[] = [
  { tone: "muted", text: "@@ modul auth — penyimpanan token @@" },
  { tone: "del", text: '- localStorage.setItem("token", accessToken)' },
  { tone: "del", text: '- localStorage.setItem("refresh", refreshToken)' },
  { tone: "add", text: '+ res.cookie("token", accessToken, { httpOnly: true, sameSite: "lax" })' },
  { tone: "add", text: '+ res.cookie("refresh", refreshToken, { httpOnly: true, sameSite: "strict" })' },
  { tone: "muted", text: "\u00a0 typecheck: ✓ lolos" },
];
