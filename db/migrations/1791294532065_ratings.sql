-- Up Migration

-- Ratings. Purely additive: the old deployment never reads or writes any of this.
CREATE TABLE player_ratings (
  user_id text PRIMARY KEY,
  rating int NOT NULL DEFAULT 1000 CHECK (rating >= 100),
  rated_games int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_ratings_leaderboard_idx ON player_ratings (rating DESC, rated_games DESC, user_id);

-- NULL = not rated yet. Set in the same statement that applies the ratings (idempotency flag).
ALTER TABLE games ADD COLUMN rated_at timestamptz;
ALTER TABLE game_players ADD COLUMN rating_before int;
ALTER TABLE game_players ADD COLUMN rating_after int;

-- No backfill: games finished before this migration are never rated. Games the old deployment finishes
-- between migrating and promotion keep rated_at NULL and are rated by the sweeper.
UPDATE games SET rated_at = COALESCE(finished_at, now()) WHERE status = 'finished';

CREATE INDEX games_unrated_idx ON games (finished_at) WHERE status = 'finished' AND rated_at IS NULL;

-- Down Migration

DROP INDEX games_unrated_idx;
ALTER TABLE game_players DROP COLUMN rating_after;
ALTER TABLE game_players DROP COLUMN rating_before;
ALTER TABLE games DROP COLUMN rated_at;
DROP TABLE player_ratings;
