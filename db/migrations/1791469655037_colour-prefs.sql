-- Up Migration

-- Up to three palette indexes (0-15), most wanted first, used to pick a colour when a signed-in player takes a seat.
-- Distinctness is enforced by the API: Postgres does not allow a subquery in a CHECK.
ALTER TABLE profiles
  ADD COLUMN colour_prefs smallint[] NOT NULL DEFAULT '{}'
  CONSTRAINT profiles_colour_prefs_valid CHECK (
    cardinality(colour_prefs) <= 3
    AND colour_prefs <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]::smallint[]
  );

-- Down Migration

ALTER TABLE profiles DROP COLUMN colour_prefs;
