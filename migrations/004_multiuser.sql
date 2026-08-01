-- Fase 5b: auth multi-user.
-- Semua statement idempoten — apply_migrations() (db.py:94-99) menjalankan
-- SELURUH file .sql pada tiap startup DAN tiap test (conftest.py:42).

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_home TEXT;

-- Dipakai auth_disabled(): EXISTS(user berpassword). Partial index supaya
-- pengecekan per-request tidak memindai tabel.
CREATE INDEX IF NOT EXISTS idx_users_with_password
  ON users (id) WHERE password_hash IS NOT NULL;
