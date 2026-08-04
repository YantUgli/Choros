-- Fase 5c: token limit per-agent untuk alert OpenCode.
-- Idempoten — aman dijalankan berulang kali oleh apply_migrations().

ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_limit INTEGER;
