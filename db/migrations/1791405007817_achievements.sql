-- Up Migration

-- Earned achievements. Purely additive: the old deployment never reads or writes this. Only ids are stored;
-- titles and rules live in code. `game_id` is the game that granted it, with no foreign key on purpose:
-- old games may be pruned, but an earned achievement must outlive them.
CREATE TABLE player_achievements (
  user_id text NOT NULL,
  achievement_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  game_id uuid,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX player_achievements_game_idx ON player_achievements (game_id) WHERE game_id IS NOT NULL;

-- Down Migration

DROP INDEX player_achievements_game_idx;
DROP TABLE player_achievements;
