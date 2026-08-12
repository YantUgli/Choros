-- Fase fan-out per-lane (Item C, adopsi ide Orca "bandingkan N → pilih pemenang").
-- Keputusan produk: fan-out dibatasi 2 cabang (muat di cap konkurensi global 3),
-- dan SELALU mode autonomous → tiap cabang di worktree terisolasi sendiri, supaya
-- N cabang tak saling menimpa folder live. Semua statement idempoten.

-- Cabang-cabang satu fan-out berbagi fanout_group_id (= id task "jangkar").
-- NULL = task biasa (bukan fan-out) → perilaku lane lama tak berubah.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fanout_group_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_tasks_fanout_group ON tasks (fanout_group_id);
