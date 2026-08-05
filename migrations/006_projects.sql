-- Fase console-rework: Project → Task → Run → Console
-- Semua statement idempoten (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL,
  folder_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id),
  user_id INT NOT NULL REFERENCES users(id),
  name VARCHAR(120) NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,   -- list slug kategori terurut
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_group_id BIGINT NOT NULL REFERENCES task_groups(id),
  user_id INT NOT NULL REFERENCES users(id),
  status VARCHAR(32) NOT NULL DEFAULT 'running',   -- running | done | halted
  created_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Kolom baru di tasks: hubungkan eksekusi console ke run + jejak delegasi
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_run_id BIGINT REFERENCES task_runs(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegated_from_task_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tasks_run_cat ON tasks (task_run_id, category);
CREATE INDEX IF NOT EXISTS idx_task_groups_project ON task_groups (project_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_group ON task_runs (task_group_id);
