-- Fase 4 penutupan: nama step supaya daftar step di UI terbaca.
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS name VARCHAR(64);
