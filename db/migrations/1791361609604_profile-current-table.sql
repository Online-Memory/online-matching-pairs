-- Up Migration

-- The table a signed-in player's browser reports in its presence heartbeat, so friends can see who is already in a game.
ALTER TABLE profiles ADD COLUMN current_table_code text;

-- Down Migration

ALTER TABLE profiles DROP COLUMN current_table_code;
