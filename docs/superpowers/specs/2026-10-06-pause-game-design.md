# Pause game: design

## Goal

Let any player pause a game in progress for up to 1 minute, e.g. to step away briefly, without losing their turn
time or being skipped.

## Decisions

- Any seated, `active` player may pause while the table is `playing`.
- A pause lasts at most 60 s (`RULES.pauseMs`). It auto-resumes via `tick(now)`.
- **Per-player budget:** each player may pause up to 5 times per game (`RULES.pausesPerPlayer = 5`). Each pause is
  still capped at 60 s; there is no other limit.
- Only the player who paused may resume early (`not_pauser` otherwise). Everyone else waits for the 60 s cap.
- Only one pause at a time.
- Out of scope: pause reason text, vote to resume, pausing in the lobby.

## Approach

Shift deadlines on resume (rather than freezing clocks). The engine stays pure and `tick` stays the only thing that
applies time. While paused, `nextDueAt` considers only `pause.until`; the other deadlines are ignored.

## Engine (`src/server/engine/`)

- `state.ts`
  - `gameStateSchema.pause: { by: string, startedAt: number, until: number } | null`, `.default(null)`.
  - `playerSchema.pausesUsed: number`, `.default(0)`. Old rows still parse.
  - `RULES.pauseMs = 60_000`, `RULES.pausesPerPlayer = 5`.
- `engine.ts`
  - New actions `pause` and `resume`.
    - `pause` is rejected unless `status === "playing"`, no pause is active, the player is `active`, and
      `pausesUsed < RULES.pausesPerPlayer`. It sets `pause = { by, startedAt: now, until: now + pauseMs }`,
      increments `pausesUsed`, emits `paused`.
    - `resume` is a no-op when nothing is paused (races the auto-resume), rejected with `not_pauser` for anyone but
      `pause.by`, and otherwise resolves the pause at `now`.
  - Resolving a pause (shared by `resume` and `tick`): `elapsed = at - startedAt`; add `elapsed` to
    `turn.deadline`, `lockUntil`, `lockStartedAt`, `abandonAt` (each when non-null); clear `pause`; emit `resumed`.
  - `tick` auto-resolves when `pause.until <= due`, at time `pause.until`.
  - `nextDueAt` returns `pause.until` while paused, otherwise unchanged.
  - `flip` and `dismiss` reject with a "game is paused" error while paused; they do not touch `lastActionAt`.
  - `leave`: if the paused player leaves, the pause ends (resolved at `now`).

## Protocol (`src/lib/protocol/`)

- `TableView.pause: { by: string, until: number } | null`.
- Action types `pause` and `resume`; public events `paused` and `resumed`. No tile data involved, so the face-down
  tile invariant is unaffected.

## Server

- `TableService` unchanged structurally: load → `tick(now)` → action → compare-and-set save. The new actions go
  through the existing table action route; no new route.
- No migration: state is JSON in `table_state`. Confirm during implementation that nothing in `games` /
  `game_players` mirroring needs a new column (not expected).

## Client

- `use-table.ts` exposes `pause()` / `resume()` through the existing action path.
- New `PauseBar`: who paused, countdown to `until` (using the same server clock offset as the turn timer), Resume
  button (only for the player who paused). Pause button on the game screen, disabled once the player's budget is spent.
- `Board` ignores clicks while `view.pause` is set.

## Testing

- Engine unit tests:
  - pause rejected in lobby, when already paused, when the 5-pause budget is spent, and resume by a non-pauser
  - flip and dismiss rejected while paused
  - auto-resume at 60 s shifts `turn.deadline` by exactly the pause length
  - flip-back lock (`lockUntil`) survives a pause
  - early resume shifts deadlines by the shorter elapsed time
  - paused player leaving ends the pause
  - old state without `pause` / `pausesUsed` parses
- Integration tests through `TableService` (pause, poll past `until`, auto-resume).
- Component test for `PauseBar`.
- Run `anti-cheat-reviewer` (touches engine, tables, protocol, API route). E2E only on demand.
