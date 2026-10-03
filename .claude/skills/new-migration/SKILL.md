---
name: new-migration
description: Add a database schema change as a new backward-compatible SQL migration in db/migrations. Use for any change to tables, columns, constraints or indexes.
---

# New migration

Existing files in `db/migrations/` are immutable (a hook blocks edits). Every schema change is a new file.

## 1. Create the file

Name it `db/migrations/<epoch-ms>_<kebab-name>.sql`, using `node -e 'console.log(Date.now())'` for the timestamp so it
sorts after every existing file. Use both sections; PGlite applies only the part above `-- Down Migration`:

```sql
-- Up Migration

-- Why this change exists, in one line.
ALTER TABLE …;

-- Down Migration

ALTER TABLE …;
```

## 2. Keep it backward compatible

Vercel runs `pnpm db:migrate` before `next build`, and the old deployment keeps serving until the new one is promoted.
The old code must keep working against the new schema.

- Add, don't change: new columns are nullable or have a default.
- Never rename or drop a column, table or constraint the current code reads or writes. Expand now; contract in a later
  migration once no deployed code uses it.
- Tightening a constraint must hold for existing rows and for rows the old code still writes.
- No interactive transactions in app code; a migration that needs a backfill does it in SQL here.

If the change can't be made backward compatible, stop and explain the two-step plan to the user.

## 3. Test

Run `pnpm test`. The integration tests migrate a fresh in-memory PGlite through every file, so a syntax error or a
broken up-migration shows there. Update `src/server/db/` and `src/server/engine/state.ts` if the shape of data changes.

## Never

- Run `pnpm db:migrate` or `pnpm db:migrate:local` (production) unless the user asks.
- Commit.
