---
name: sync-docs
description: Bring CLAUDE.md, the project skills and agents, and README.md up to date with this session's changes, only where a documented fact changed. Use when the user is wrapping up the session ("done for today", "wrap up") or asks to sync or update the docs.
---

# Sync docs

Docs in scope: `CLAUDE.md`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `README.md`.

## 1. Collect the session's changes

```bash
git status --porcelain
git diff HEAD
```

Read untracked files too. Nothing is committed during a session, so the working tree holds everything.

## 2. Find documented facts the changes made wrong or incomplete

Check, for each change:

- **Paths**: a file or directory named in the `CLAUDE.md` map, a skill or the agent was moved, renamed or added
  alongside documented ones (e.g. a new route under `src/app/api/tables/`).
- **Commands**: a `package.json` script, the CI steps in `.github/workflows/ci.yml`, or a hook in
  `.claude/settings.json` changed. Update the `CLAUDE.md` commands, the skills that run them and the README scripts
  table.
- **Environments**: new or renamed env vars (`src/lib/env.ts`, `.env.example`), database or driver changes.
- **Invariants**: redaction, the server-only boundary, engine purity, compare-and-set saves, history queries or
  migration rules changed. Update `CLAUDE.md`, the README anti-cheat checklist and `anti-cheat-reviewer` together, and
  extend the agent's trigger paths in `CLAUDE.md` if a new file now handles game state.
- **Workflows**: a skill's steps no longer match what you actually had to do this session.

## 3. Edit only what is now wrong or missing

- If nothing documented changed, edit nothing.
- Keep edits small and in each file's existing style. Facts that live in the README stay there; `CLAUDE.md` points to
  them rather than repeating them.
- Don't record session history, one-off fixes, or anything git already tracks.
- Never edit the block between the `nextjs-agent-rules` markers in `CLAUDE.md`; `next dev` owns it.

## 4. Report

List each file changed with one line on why, or say "docs up to date". Don't commit.
