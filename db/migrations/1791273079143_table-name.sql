-- Up Migration

-- Hosts name their table; the public directory shows it. Mirrored from the table state like host_name.
-- The default keeps the old deployment (which never sets it) working.
ALTER TABLE games ADD COLUMN table_name text NOT NULL DEFAULT '';

-- Down Migration

ALTER TABLE games DROP COLUMN table_name;
