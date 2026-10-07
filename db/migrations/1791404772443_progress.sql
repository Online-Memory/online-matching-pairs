-- Up Migration

-- XP and levels. Purely additive: the old deployment never reads or writes any of this.
CREATE TABLE player_progress (
  user_id text PRIMARY KEY,
  xp int NOT NULL DEFAULT 0 CHECK (xp >= 0),
  version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- NULL = XP not awarded yet. Set in the same statement that updates every player's XP (idempotency flag).
-- Separate from rated_at: solo games and games with guests are never rated but still award XP.
ALTER TABLE games ADD COLUMN progress_applied_at timestamptz;
ALTER TABLE game_players ADD COLUMN xp_gained int;
ALTER TABLE game_players ADD COLUMN xp_after int;

-- No retroactive XP: games finished before this migration are never awarded. Games the old deployment
-- finishes between migrating and promotion keep progress_applied_at NULL and are awarded by the sweeper.
UPDATE games SET progress_applied_at = COALESCE(finished_at, now()) WHERE status = 'finished';

CREATE INDEX games_unprogressed_idx ON games (finished_at)
  WHERE status = 'finished' AND progress_applied_at IS NULL;

-- Down Migration

DROP INDEX games_unprogressed_idx;
ALTER TABLE game_players DROP COLUMN xp_after;
ALTER TABLE game_players DROP COLUMN xp_gained;
ALTER TABLE games DROP COLUMN progress_applied_at;
DROP TABLE player_progress;
