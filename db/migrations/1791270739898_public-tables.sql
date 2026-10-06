-- Up Migration

-- Public table directory. The directory reads these mirrored columns instead of table_state.
-- Defaults keep the old deployment working: its tables stay private.
ALTER TABLE games ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN player_count int NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN host_name text NOT NULL DEFAULT '';
CREATE INDEX games_public_idx ON games (created_at DESC)
  WHERE is_public AND status IN ('lobby', 'playing');

-- Down Migration

DROP INDEX games_public_idx;
ALTER TABLE games DROP COLUMN host_name;
ALTER TABLE games DROP COLUMN player_count;
ALTER TABLE games DROP COLUMN is_public;
