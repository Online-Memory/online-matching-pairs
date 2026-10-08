# Kick vote on turn timeout

## Goal

When a player's turn timer runs out, the turn no longer passes on. The other players may vote to kick them. A kicked
player stays at the table as a spectator (cannot play, pause or vote) until the game ends.

## Decisions (agreed)

- The turn is **held** on the timed-out player. If they flip a tile before the vote passes, the vote is cancelled and
  play continues with a fresh deadline.
- Kicking needs a **unanimous** vote of eligible voters. Eligible = `active` players other than the target. There is no
  "no" vote; not voting is the same as voting no.
- A kicked player keeps their pairs and is ranked and rated like any other finisher. `games`, `game_players` and
  ratings are unchanged.

## State (`src/server/engine/state.ts`)

- `turn`: `{ playerId, deadline: number | null, timedOut: boolean, kickVotes: string[] }`. `timedOut` and `kickVotes`
  default to `false` / `[]` so rows saved before this change still parse.
- Player `status` gains `"kicked"`. It is final for the game; `join` only reactivates `away` players, so a rejoin stays
  a no-op for kicked players.
- `RULES.timeoutsBeforeAway` and `PlayerState.timeouts` no longer drive the normal timeout path (the turn is held).
  They count consecutive timeouts only when nobody else can vote, so a game with no opponents still ends.

## Engine (`src/server/engine/engine.ts`)

- **Timeout** (`applyDue`): emit `turn_timed_out`, reset the streak, leave any tile they already turned over face up (it goes face down when the turn moves on: kick, no-voter skip, or their next flip resolving), set `turn.deadline = null`,
  `turn.timedOut = true`. Do not call `advanceTurn`. Set `abandonAt = due + RULES.allAwayAbandonMs` if it is null, so a
  table nobody votes on is still abandoned by the existing path. `abandonAt` is cleared when the turn resumes or the
  player is kicked.
- **No eligible voters** (e.g. the only opponent is away or left): fall back to today's behaviour and advance the turn.
- **`vote_kick` action**: valid only while `turn.timedOut`. The voter must be `active` and not the target; repeat
  votes are ignored. When `kickVotes` covers every eligible voter, set the target `kicked`, emit `player_kicked`, clear
  `abandonAt`, hand over host if they were host, then `advanceTurn`. Emit `kick_vote` on each new vote.
- **Resume**: a `flip` from the timed-out player clears `timedOut`/`kickVotes`, restarts the deadline and clears the
  `abandonAt` set by the timeout.
- **Spectators**: `flip`, `pause` and `vote_kick` reject `kicked` players. `advanceTurn` skips them. Game-end and
  ranking logic treat them as players.
- **Eligible set shrinks** (a voter leaves or goes away mid-vote): re-check the unanimity condition after any status
  change while `timedOut`, so the vote cannot get stuck.
- **Pause**: a pause freezes the vote the same way it freezes deadlines; `vote_kick` is rejected while paused.
- `nextDueAt` ignores a null `deadline`; the held turn schedules only `abandonAt`.

## Protocol and API

- `PublicEvent` gains `kick_vote` and `player_kicked`. The player view gains `kicked`; the table view gains
  `kickVote: { targetId, votes, needed, youVoted } | null` and `canVoteKick`. All derived in `toView`; no tile data
  involved. `turn` in the view carries `{ playerId, deadline: number | null, timedOut }` (never the voter list).
- New error codes: `kick_unavailable` (no held turn, or voter is the target) and `kicked` (a spectator tried to act).
- `PlayerState.timeouts` is kept (`default(0)`, written as 0 for new players) so the previous deployment's schema still
  parses new rows on rollback. The `away` status is still set by the no-voter timeout path.
- New route `POST /api/tables/[code]/vote-kick`, a thin wrapper over `TableService` like `pause`.

## Client

- Voters: a "Vote to kick @name (votes/needed)" bar while `kickVote` is set.
- Timed-out player: "Your turn timed out. Flip a tile to carry on."
- Kicked player: spectator banner, board disabled, scoreboard still visible.

## Testing

- Engine unit tests: timeout holds the turn; partial vote does nothing; unanimous vote kicks and advances; the target
  flipping cancels the vote; spectator cannot flip, pause or vote; spectator skipped in turn order; no-eligible-voters
  fallback; host kicked hands over host; voter leaving mid-vote re-evaluates; pause freezes the vote; held turn is
  abandoned after `allAwayAbandonMs`; old saved state without the new fields parses.
- Integration test through the route with PGlite.
- Run the `anti-cheat-reviewer` agent (touches engine, protocol, `api/tables`).
