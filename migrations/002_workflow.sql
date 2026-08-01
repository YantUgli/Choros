-- Fase 4: workflow plan→execute
-- Semua statement idempoten (IF NOT EXISTS / IF EXISTS).

-- §3.1: status 'awaiting_approval' = 17 karakter, VARCHAR(16) tidak muat
ALTER TABLE tasks ALTER COLUMN status TYPE VARCHAR(32);

-- §3.2: step planner perlu kategori sendiri supaya tidak tersaring adapter_can_execute
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS category VARCHAR(32);

-- Tabel baru: satu run = satu eksekusi workflow, memiliki worktree
CREATE TABLE IF NOT EXISTS workflow_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_id INT NOT NULL REFERENCES workflows(id),
  user_id INT NOT NULL REFERENCES users(id),
  goal TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  current_step INT NOT NULL DEFAULT 0,
  project_path TEXT,
  workspace_path TEXT,
  mode VARCHAR(16) NOT NULL DEFAULT 'interactive',
  allow_unisolated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Kolom baru di tasks untuk menghubungkan step task ke run
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_run_id BIGINT REFERENCES workflow_runs(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS step_order INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owns_workspace BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks (workflow_run_id, step_order);
