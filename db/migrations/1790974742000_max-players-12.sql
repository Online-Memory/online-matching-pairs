-- Up Migration

-- Signed-in hosts can seat up to 12; guests are capped at 4 by the API, not the database.
ALTER TABLE games DROP CONSTRAINT games_max_players_check;
ALTER TABLE games ADD CONSTRAINT games_max_players_check CHECK (max_players BETWEEN 1 AND 12);

-- Down Migration

ALTER TABLE games DROP CONSTRAINT games_max_players_check;
ALTER TABLE games ADD CONSTRAINT games_max_players_check CHECK (max_players BETWEEN 1 AND 4);
