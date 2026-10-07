# Gamification Phase 1: In-game juice

Part of a three-phase gamification effort (1: in-game juice, 2: post-game payoff, 3: progression and
achievements). This spec covers Phase 1 only.

## Goal

Make moment-to-moment play feel more rewarding and visually exciting by escalating visual feedback as a
player's match streak grows. No migration, and nothing hidden leaves the server.

## Success criteria

- A player on a streak of 2 or more is visibly distinguished on the scoreboard, with escalating intensity.
- A match shows a floating score pop-up and a small confetti burst scaled by streak tier.
- Breaking a streak of 3 or more has visible feedback.
- All motion respects `prefers-reduced-motion`; the streak information remains available statically.
- The streak is correct after a reload, a reconnect, or when spectating mid-game.

## Design

### 1. Data: expose the current streak

`PlayerView` (`src/lib/protocol/index.ts`) gains `streak: number`, populated in `toView`
(`src/server/engine/engine.ts`) from the engine's existing per-player `streak`. It resets on a miss or a
turn timeout (existing engine behavior; unchanged). The value is public information and cannot reveal a
hidden tile face. Backward compatible; no migration. Since this touches the engine and protocol, the
`anti-cheat-reviewer` agent runs on the diff.

### 2. Tier function

`streakTier(streak: number): "none" | "warm" | "hot" | "fire"` in `src/lib/client/` (pure, unit-tested):

| Streak | Tier               |
| ------ | ------------------ |
| 0-1    | none               |
| 2      | warm (glow)        |
| 3-4    | hot (flame border) |
| 5+     | fire (full effect) |

All visuals key off `data-streak-tier` attributes so the styling stays declarative in CSS.

### 3. Effects

- **Seat card:** `Scoreboard` sets `data-streak-tier` on each `seat` and shows an `x{n}` chip. The tier
  drives a glow or flame animation.
- **Score pop-up:** on a `pair_matched` event, a floating `+1` (or `+1 · x3 STREAK`) rises from the matched
  tiles. Reuses the event-watching logic that already drives `celebrating` in `TableScreen`.
- **Match burst:** a lightweight `burst({ count, origin })` mode for the canvas confetti, scaled by tier.
  The end-of-game `Confetti` show is unchanged.
- **Streak broken:** when a streak of 3 or more ends, the seat chip shakes and fades.
- **Tension:** when two tiles remain the board outline pulses; the `TurnTimer` `data-urgent` state
  (5 seconds or less) gains a pulse. (`Spotlight` already renders all game, so it is not the last-pair cue.)

### 4. Accessibility

Every animation is gated behind `prefers-reduced-motion: no-preference`, matching the existing pattern in
`globals.css`. Under reduced motion the static tier chip remains.

### 5. Testing

- Unit: `streakTier` thresholds.
- Engine: `toView` exposes `streak`, and it resets after a miss and after a timeout.
- Component: `Scoreboard` sets `data-streak-tier` and renders the chip.
- No pixel-level animation tests. E2E runs only on request.

## Out of scope

Sound, persistence, XP/levels, achievements (Phases 2 and 3).

## Verification

`verify` skill (lint, format, typecheck, Vitest) and the `anti-cheat-reviewer` agent before declaring done.
