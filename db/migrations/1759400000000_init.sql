-- Up Migration

CREATE TABLE games (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  host_player_id text NOT NULL,
  theme text NOT NULL,
  pairs int NOT NULL CHECK (pairs > 0),
  max_players int NOT NULL CHECK (max_players BETWEEN 1 AND 4),
  turn_seconds int NOT NULL CHECK (turn_seconds > 0),
  status text NOT NULL CHECK (status IN ('lobby', 'playing', 'finished', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX games_status_created_at_idx ON games (status, created_at);

-- Public, durable record of who played. Written when a game starts and when it ends.
CREATE TABLE game_players (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  player_id text NOT NULL,
  user_id text,
  display_name text NOT NULL,
  seat int NOT NULL,
  moves int NOT NULL DEFAULT 0,
  pairs int NOT NULL DEFAULT 0,
  best_streak int NOT NULL DEFAULT 0,
  rank int,
  PRIMARY KEY (game_id, player_id)
);

CREATE INDEX game_players_user_id_idx ON game_players (user_id) WHERE user_id IS NOT NULL;

-- Live table state, including the secret board. Only the TableService reads this; history and
-- profile queries must never select from or join it.
CREATE TABLE table_state (
  game_id uuid PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  version int NOT NULL,
  state jsonb NOT NULL,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_due_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX table_state_updated_at_idx ON table_state (updated_at);

-- Down Migration

DROP TABLE table_state;
DROP TABLE game_players;
DROP TABLE games;
