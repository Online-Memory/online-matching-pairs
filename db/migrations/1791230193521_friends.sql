-- Up Migration

-- Friends, presence and table invites. Purely additive: the old deployment never touches these tables.
CREATE TABLE profiles (
  user_id text PRIMARY KEY,
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE friendships (
  user_a text NOT NULL,
  user_b text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (requested_by IN (user_a, user_b))
);
CREATE INDEX friendships_user_b_idx ON friendships (user_b);

CREATE TABLE table_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_code text NOT NULL,
  from_user text NOT NULL,
  to_user text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (table_code, to_user)
);
CREATE INDEX table_invites_to_user_idx ON table_invites (to_user, expires_at);

-- Down Migration

DROP TABLE table_invites;
DROP TABLE friendships;
DROP TABLE profiles;
