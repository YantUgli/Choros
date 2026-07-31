-- choros v0.2 — skema awal (PRD §9)
-- Tabel users/agents/routing_rules/workflows/workflow_steps/task_logs/quota_windows
-- persis PRD. Tambahan di luar PRD (didokumentasikan): `tasks` dan `task_events`,
-- dibutuhkan agar live console punya entitas tugas dan bisa replay stream.

CREATE TABLE IF NOT EXISTS users (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  adapter_type VARCHAR(32) NOT NULL,   -- 'claude_code','antigravity','opencode','openai_compatible'
  base_url TEXT,
  default_model VARCHAR(64),
  config JSONB DEFAULT '{}',           -- api_key ref, permission defaults, trust config, dll.
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category VARCHAR(32) NOT NULL,
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),                   -- target spesifik sampai model
  priority INT DEFAULT 100
);
CREATE INDEX IF NOT EXISTS idx_routing_category_priority ON routing_rules (category, priority);

CREATE TABLE IF NOT EXISTS workflows (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id INT NOT NULL REFERENCES workflows(id),
  step_order INT NOT NULL,
  role_prompt TEXT,                    -- 'planner','business','developer','devops'
  targets JSONB DEFAULT '[]',          -- daftar (agent,model) berurut utk cascade step ini
  quality_floor VARCHAR(64),           -- batas bawah model (PRD §6.2)
  requires_approval BOOLEAN DEFAULT FALSE
);

-- TAMBAHAN (di luar PRD §9): entitas tugas yang disubmit user.
-- PRD hanya punya task_logs (catatan per-percobaan); live console + resume
-- butuh entitas tugas yang bertahan lintas percobaan/fallback.
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  prompt TEXT NOT NULL,
  category VARCHAR(32) NOT NULL,
  mode VARCHAR(16) NOT NULL DEFAULT 'interactive',   -- 'interactive','autonomous'
  project_path TEXT,
  quality_floor VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'queued',      -- queued,running,ok,halted,error,cancelled
  plan_artifact TEXT,                  -- titik-ulang berbasis plan (PRD §6.1)
  final_output TEXT,
  workspace_path TEXT,                 -- worktree terisolasi bila mode otonom
  allow_unisolated BOOLEAN DEFAULT FALSE,  -- opt-out isolasi, harus dipilih eksplisit
  last_session_id TEXT,                -- id sesi harness, untuk follow-up
  parent_task_id BIGINT,               -- tugas asal bila ini lanjutan tanya-jawab
  resume_session_id TEXT,              -- sesi yang dilanjutkan
  pinned_agent_id INT REFERENCES agents(id),  -- follow-up wajib ke agent yang sama
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_time ON tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  task_id BIGINT REFERENCES tasks(id),
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),
  category VARCHAR(32),
  mode VARCHAR(16),                    -- 'interactive','autonomous'
  status VARCHAR(16),                  -- 'ok','rate_limited','error','halted'
  usage JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasklogs_agent_time ON task_logs (agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasklogs_task ON task_logs (task_id);

-- TAMBAHAN (di luar PRD §9): stream event ternormalisasi, untuk replay live console.
CREATE TABLE IF NOT EXISTS task_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id),
  seq INT NOT NULL,
  type VARCHAR(24) NOT NULL,           -- thinking,tool_call,file_edit,output,question,usage,error,status
  agent VARCHAR(64),
  model VARCHAR(64),
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (task_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_taskevents_task_seq ON task_events (task_id, seq);

CREATE TABLE IF NOT EXISTS quota_windows (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  agent_id INT NOT NULL REFERENCES agents(id),
  model VARCHAR(64),                   -- per-model (limit Groq per-model)
  window_type VARCHAR(16),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  tokens_used INT DEFAULT 0,
  is_exhausted BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_quota_lookup ON quota_windows (agent_id, model, window_end);
