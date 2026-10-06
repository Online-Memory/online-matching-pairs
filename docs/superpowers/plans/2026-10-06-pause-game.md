# Pause Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any active player can pause a running game for up to 1 minute (up to 5 times per player per game, each capped at 60 s); only the player who paused can resume early, otherwise the game auto-resumes and nobody loses clock time.

**Architecture:** A `pause` record in `GameState` makes `nextDueAt` return only `pause.until`. Ending a pause (early `resume` action, or `tick` reaching `until`) shifts `turn.deadline`, `lockUntil`, `lockStartedAt` and `abandonAt` forward by the paused duration. The engine stays pure; `tick(now)` remains the only thing applying time.

**Tech Stack:** Next.js (see `node_modules/next/dist/docs/` before touching route handlers), TypeScript, zod, Vitest, PGlite integration tests.

**Spec:** `docs/superpowers/specs/2026-10-06-pause-game-design.md`

## Global Constraints

- Pause length 60 s (`RULES.pauseMs = 60_000`); budget 5 pauses per player per game (`RULES.pausesPerPlayer = 5`); only the pauser may resume early.
- Engine stays pure: no I/O, no `Date.now()`. Everything under `src/server/` starts with `import "server-only"`.
- State leaves the server only via `toView`. No tile data is added to any view or event.
- No migration: state is JSON, new schema fields use `.default(...)` so old rows parse.
- Git is the user's call: **do not commit, branch or push.** Leave changes in the working tree.
- Do not run E2E (Playwright) and do not touch `.env*` files.
- Correction to the spec: routes are one directory per action (`src/app/api/tables/[code]/dismiss/route.ts`), so this plan adds `pause/` and `resume/` routes. Also: `dismiss` during a pause is a silent no-op (matching its existing "anything else is a no-op" behaviour) rather than an error; `flip` throws `paused`. The view gains `canPause` and `pause.startedAt` so the client can disable the button and freeze the turn timer.

## Review Focus

- The paused player leaves mid-pause: pause must end and the game must continue (Task 1 test).
- A non-pauser leaves on their own turn during a pause: the next player must get a full `turnSeconds` after resume, not extra (Task 1 test).
- Pause while a mismatched pair is face up: tiles stay up and the flip-back lock gets the paused time back (Task 1 test).
- Someone other than the pauser tries to resume: rejected with `not_pauser`, pause keeps running (Task 1 test).
- Resume/auto-resume racing: `resume` with no active pause is a harmless no-op (Task 1 test).
- State saved before this feature (no `pause`, no `pausesUsed`) must still parse (Task 1 test).

---

### Task 1: Engine, state and protocol types

**Files:**

- Modify: `src/server/engine/state.ts` (RULES, `playerSchema`, `gameStateSchema`)
- Modify: `src/server/engine/engine.ts` (actions, `beginTurn`, `abandon`, `nextDueAt`, `applyDue`, `toView`)
- Modify: `src/lib/protocol/index.ts` (`TableView`, `PublicEvent`, `ERROR_CODES`)
- Test: `src/server/engine/engine.test.ts`

**Interfaces:**

- Produces: `Action` gains `{ type: "pause" } | { type: "resume" }`; `GameState.pause: { by: string; startedAt: number; until: number } | null`; `PlayerState.pausesUsed: number`; `RULES.pauseMs`, `RULES.pausesPerPlayer`; `TableView.pause: { by: string; startedAt: number; until: number } | null`; `TableView.canPause: boolean`; events `{ type: "paused"; playerId: string; until: number }` and `{ type: "resumed" }`; error codes `"paused"`, `"pause_unavailable"` and `"not_pauser"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/engine/engine.test.ts` (helpers `started`, `act`, `mismatch`, `pairOf`, `expectError`, `T0`, `id` already exist in the file):

```ts
describe("pause", () => {
  const MIN = RULES.pauseMs;

  it("can only be started by an active player in a running game, five times each", () => {
    expectError(() => act(lobby(2), "p1", { type: "pause" }, T0), "not_playing");
    const s = started(2);
    const paused = act(s, "p2", { type: "pause" }, T0 + 1_000);
    expect(paused.pause).toEqual({ by: "p2", startedAt: T0 + 1_000, until: T0 + 1_000 + MIN });
    expectError(() => act(paused, "p1", { type: "pause" }, T0 + 2_000), "paused");
  });

  it("gives each player five pauses, then refuses a sixth", () => {
    let s = started(2);
    let t = T0;
    for (let n = 1; n <= RULES.pausesPerPlayer; n++) {
      t += 1_000;
      s = act(s, "p2", { type: "pause" }, t);
      t += 1_000;
      s = act(s, "p2", { type: "resume" }, t);
    }
    expect(s.players.find((p) => p.id === "p2")!.pausesUsed).toBe(5);
    expectError(() => act(s, "p2", { type: "pause" }, t + 1_000), "pause_unavailable");
    // p1's budget is separate
    expect(act(s, "p1", { type: "pause" }, t + 1_000).pause?.by).toBe("p1");
  });

  it("lets only the player who paused resume early", () => {
    const paused = act(started(2), "p2", { type: "pause" }, T0 + 1_000);
    expectError(() => act(paused, "p1", { type: "resume" }, T0 + 2_000), "not_pauser");
    expect(act(paused, "p2", { type: "resume" }, T0 + 2_000).pause).toBeNull();
  });

  it("blocks flips, ignores dismiss, and schedules only its own end", () => {
    const s = act(started(2), "p1", { type: "pause" }, T0 + 1_000);
    expectError(() => act(s, "p1", { type: "flip", tileId: 0 }, T0 + 2_000), "paused");
    expect(act(s, "p1", { type: "dismiss" }, T0 + 2_000)).toEqual(s);
    expect(nextDueAt(s)).toBe(T0 + 1_000 + MIN);
  });

  it("shifts the turn deadline by the paused time when it auto-resumes", () => {
    const s = started(2, { turnSeconds: 20 });
    const deadline = s.turn!.deadline; // T0 + 20_000
    const paused = act(s, "p2", { type: "pause" }, T0 + 5_000);
    const { state, events } = tick(paused, T0 + 5_000 + MIN + 10);
    expect(state.pause).toBeNull();
    expect(state.turn!.deadline).toBe(deadline + MIN);
    expect(state.turn!.playerId).toBe("p1");
    expect(events.map((e) => e.type)).toEqual(["resumed"]);
  });

  it("shifts by the shorter elapsed time on an early resume", () => {
    const s = started(2, { turnSeconds: 20 });
    const paused = act(s, "p1", { type: "pause" }, T0 + 5_000);
    const resumed = act(paused, "p1", { type: "resume" }, T0 + 15_000);
    expect(resumed.pause).toBeNull();
    expect(resumed.turn!.deadline).toBe(s.turn!.deadline + 10_000);
  });

  it("gives a face-up mismatch its remaining lock time back", () => {
    let s = started(2);
    const [a, b] = mismatch(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 100);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 200);
    const lockUntil = s.lockUntil!;
    s = act(s, "p2", { type: "pause" }, T0 + 1_000);
    s = tick(s, T0 + 1_000 + MIN + 1).state;
    expect(s.lockUntil).toBe(lockUntil + MIN);
    expect(s.revealed).toHaveLength(2); // still face up, not yet flipped back
    expect(s.pause).toBeNull();
  });

  it("is a harmless no-op to resume when nothing is paused", () => {
    const s = started(2);
    expect(act(s, "p1", { type: "resume" }, T0 + 1_000)).toEqual(s);
  });

  it("ends when the player who paused leaves", () => {
    const s = act(started(3), "p3", { type: "pause" }, T0 + 1_000);
    const after = act(s, "p3", { type: "leave" }, T0 + 2_000);
    expect(after.pause).toBeNull();
    expect(after.status).toBe("playing");
  });

  it("gives the next player a full turn when someone leaves on their turn mid-pause", () => {
    const s = act(started(3, { turnSeconds: 20 }), "p3", { type: "pause" }, T0 + 1_000);
    const left = act(s, "p1", { type: "leave" }, T0 + 2_000); // p1 held the turn
    expect(left.turn!.playerId).toBe("p2");
    const resumed = act(left, "p3", { type: "resume" }, T0 + 11_000);
    expect(resumed.turn!.deadline).toBe(T0 + 11_000 + 20_000);
  });

  it("clears the pause when the game is abandoned", () => {
    const s = act(started(2), "p1", { type: "pause" }, T0 + 1_000);
    const a = act(s, "p1", { type: "leave" }, T0 + 2_000);
    const b = act(a, "p2", { type: "leave" }, T0 + 3_000);
    expect(b.status).toBe("abandoned");
    expect(b.pause).toBeNull();
  });

  it("is visible in the view, with canPause only for someone who can still pause", () => {
    const s = started(2);
    expect(toView(s, "p1")).toMatchObject({ pause: null, canPause: true });
    expect(toView(s, null).canPause).toBe(false);
    const paused = act(s, "p1", { type: "pause" }, T0 + 1_000);
    expect(toView(paused, "p2")).toMatchObject({
      pause: { by: "p1", startedAt: T0 + 1_000, until: T0 + 1_000 + MIN },
      canPause: false,
    });
    const resumed = act(paused, "p1", { type: "resume" }, T0 + 2_000);
    expect(toView(resumed, "p1").canPause).toBe(true); // 4 of 5 pauses left
    expect(toView(resumed, "p2").canPause).toBe(true);
    let s = started(2);
    for (let n = 0; n < RULES.pausesPerPlayer; n++) {
      s = act(s, "p1", { type: "pause" }, T0 + 1_000 * (2 * n + 1));
      s = act(s, "p1", { type: "resume" }, T0 + 1_000 * (2 * n + 2));
    }
    expect(toView(s, "p1").canPause).toBe(false); // budget spent
    expect(toView(s, "p2").canPause).toBe(true);
  });

  it("parses state saved before pausing existed", () => {
    const { pause: _pause, ...old } = started(2);
    const legacy = { ...old, players: old.players.map(({ pausesUsed: _p, ...p }) => p) };
    const parsed = gameStateSchema.parse(legacy);
    expect(parsed.pause).toBeNull();
    expect(parsed.players.every((p) => p.pausesUsed === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/server/engine/engine.test.ts -t pause`
Expected: FAIL (type errors / `pause` action unknown).

- [ ] **Step 3: Protocol types** in `src/lib/protocol/index.ts`

In `TableView`, after `lockUntil`:

```ts
  /** Set while the game is paused. `until` is when it resumes by itself; times are server epoch ms. */
  pause: { by: string; startedAt: number; until: number } | null;
  /** Whether the viewer can start a pause right now (seated, active, game running, budget left). */
  canPause: boolean;
```

In `PublicEvent`, before `{ type: "abandoned" }`:

```ts
    | { type: "paused"; playerId: string; until: number }
    | { type: "resumed" }
```

In `ERROR_CODES`, after `"locked"`: `"paused",`, `"pause_unavailable",` and `"not_pauser",`.

- [ ] **Step 4: State** in `src/server/engine/state.ts`

In `RULES`, after `maxTickIterations` doc block (before `} as const`):

```ts
  /** A pause ends by itself after this long. */
  pauseMs: 60_000,
  /** Pauses each player may start per game. */
  pausesPerPlayer: 5,
```

In `playerSchema` add after `lastActionAt`: `pausesUsed: z.number().int().default(0),`

In `gameStateSchema` after `lockStartedAt`:

```ts
  /** Set while paused. All other deadlines are frozen and shifted forward when it ends. */
  pause: z.object({ by: z.string(), startedAt: z.number(), until: z.number() }).nullable().default(null),
```

- [ ] **Step 5: Engine** in `src/server/engine/engine.ts`

`Action` union: add `| { type: "pause" } | { type: "resume" }`.

`createTable`: add `pause: null,` after `lockStartedAt: null,`. `newPlayer`: add `pausesUsed: 0,` after `timeouts: 0,`.

`applyAction` switch, add:

```ts
    case "pause":
      pause(draft, actorId, now);
      break;
    case "resume":
      resume(draft, actorId, now);
      break;
```

`flip`: after the `not_playing` check add
`if (s.pause) throw new EngineError("paused", "The game is paused");`

`dismiss`: change the guard to
`if (s.status !== "playing" || s.pause || s.lockUntil === null || s.turn?.playerId !== actorId) return;`

`leave`: after `if (s.status !== "playing" || player.status === "left") return;` add
`if (s.pause?.by === actorId) endPause(draft, now);`

Add after `leave`:

```ts
function pause(draft: Draft, actorId: string, now: number) {
  const s = draft.state;
  if (s.status !== "playing") throw new EngineError("not_playing", "The game is not in progress");
  const player = requirePlayer(s, actorId);
  if (s.pause) throw new EngineError("paused", "The game is already paused");
  if (player.status !== "active") throw new EngineError("pause_unavailable", "Rejoin the game to pause it");
  if (player.pausesUsed >= RULES.pausesPerPlayer) {
    throw new EngineError("pause_unavailable", "You have used all your pauses");
  }
  player.pausesUsed += 1;
  s.pause = { by: actorId, startedAt: now, until: now + RULES.pauseMs };
  draft.emit({ type: "paused", playerId: actorId, until: s.pause.until }, now);
}

/** Only the player who paused can end it early. With nothing paused (e.g. racing the auto-resume) it does nothing. */
function resume(draft: Draft, actorId: string, now: number) {
  const s = draft.state;
  requirePlayer(s, actorId);
  if (!s.pause) return;
  if (s.pause.by !== actorId) throw new EngineError("not_pauser", "Only the player who paused can resume");
  endPause(draft, now);
}

/**
 * Ends the pause at `at` and hands the paused time back: every running deadline moves forward by how
 * long the game stood still.
 */
function endPause(draft: Draft, at: number) {
  const s = draft.state;
  if (!s.pause) return;
  const elapsed = at - s.pause.startedAt;
  if (s.turn) s.turn.deadline += elapsed;
  if (s.lockUntil !== null) s.lockUntil += elapsed;
  if (s.lockStartedAt !== null) s.lockStartedAt += elapsed;
  if (s.abandonAt !== null) s.abandonAt += elapsed;
  s.pause = null;
  draft.emit({ type: "resumed" }, at);
}
```

`beginTurn`: while paused, deadlines live in the frozen frame (resume adds the elapsed time), so replace its first line with:

```ts
// While paused the clock is frozen at the pause's start; endPause adds the paused time back.
const deadline = (draft.state.pause?.startedAt ?? at) + draft.state.turnSeconds * 1000;
```

`abandon`: add `s.pause = null;` after `s.lockUntil = null;`.

`nextDueAt`: after the `status !== "playing"` line add `if (s.pause) return s.pause.until; // everything else is frozen`.

`applyDue`: after the lobby line add `if (s.pause) return endPause(draft, due);`.

`toView`: after `lockUntil: s.lockUntil,` add

```ts
    pause: s.pause ? { ...s.pause } : null,
    canPause: canPause(s, viewerId),
```

and add helper:

```ts
function canPause(s: GameState, viewerId: string | null): boolean {
  if (s.status !== "playing" || s.pause) return false;
  const player = s.players.find((p) => p.id === viewerId);
  return !!player && player.status === "active" && player.pausesUsed < RULES.pausesPerPlayer;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run src/server/engine/engine.test.ts`
Expected: PASS (all, including pre-existing). Then `pnpm typecheck`; fix any `PlayerState`/`GameState`/`TableView` literals in other tests that now miss `pausesUsed` / `pause` / `canPause`. Component fixtures built with `as unknown as TableView` are unaffected.

---

### Task 2: Routes, API client and `useTable`

**Files:**

- Create: `src/app/api/tables/[code]/pause/route.ts`, `src/app/api/tables/[code]/resume/route.ts`
- Modify: `src/lib/client/api.ts`, `src/lib/client/use-table.ts`, `src/components/TableScreen.test.tsx` (mock handle)
- Test: `src/lib/client/use-table.test.ts`

**Interfaces:**

- Consumes: `playerAction` from `@/server/actions`; `Action` pause/resume from Task 1.
- Produces: `api.pause(code, since)`, `api.resume(code, since)`; `TableHandle.pause: () => Promise<void>`, `TableHandle.resume: () => Promise<void>`.

- [ ] **Step 1: Read the guide.** Skim `node_modules/next/dist/docs/` for route handlers and confirm the `dismiss/route.ts` pattern is still current. Then create both routes, identical in shape to `dismiss/route.ts`:

```ts
import { playerAction } from "@/server/actions";

export const POST = playerAction(async () => ({ type: "pause" }));
```

and the same with `"resume"`.

- [ ] **Step 2: Write the failing test.** Look at how `use-table.test.ts` tests `dismiss` (it mocks `api`), and add the same style of test asserting `pause()` calls `api.pause(code, since)` and `resume()` calls `api.resume(code, since)`.

- [ ] **Step 3: Run:** `pnpm vitest run src/lib/client/use-table.test.ts` → FAIL.

- [ ] **Step 4: Implement.**
  - `api.ts`, after `dismiss`:
    ```ts
      pause: (code: string, since: number) => post<SnapshotResponse>(table(code, "pause", since)),
      resume: (code: string, since: number) => post<SnapshotResponse>(table(code, "resume", since)),
    ```
  - `use-table.ts`: in `TableHandle` add
    ```ts
    /** Pauses the game for up to a minute (up to 5 times per player). */
    pause: () => Promise<void>;
    /** Ends a pause early. */
    resume: () => Promise<void>;
    ```
    and in the returned object after `dismiss`:
    ```ts
        pause: () => run((s) => api.pause(code, s)),
        resume: () => run((s) => api.resume(code, s)),
    ```
  - `TableScreen.test.tsx` `mockTable`: add `pause: vi.fn(), resume: vi.fn(),` after `dismiss: vi.fn(),`.

- [ ] **Step 5: Run:** `pnpm vitest run src/lib/client src/components/TableScreen.test.tsx` → PASS.

---

### Task 3: UI

**Files:**

- Create: `src/components/PauseBar.tsx`, `src/components/PauseBar.test.tsx`
- Modify: `src/components/TurnTimer.tsx`, `src/components/Scoreboard.tsx`, `src/components/TableScreen.tsx`, `src/app/globals.css`

**Interfaces:**

- Consumes: `TableView.pause`, `TableView.canPause`, `TableHandle.pause/resume`.
- Produces: `<PauseBar view serverOffset pending onResume />`; `TurnTimer` optional prop `frozenAt?: number`.

- [ ] **Step 1: Write the failing test** `src/components/PauseBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TableView } from "@/lib/protocol";

import { PauseBar } from "./PauseBar";

afterEach(cleanup);

const view = {
  youId: "a",
  players: [
    { id: "a", name: "Ann", status: "active" },
    { id: "b", name: "Bob", status: "active" },
  ],
  pause: { by: "b", startedAt: 1_000, until: 61_000 },
} as unknown as TableView;

describe("PauseBar", () => {
  it("names who paused and counts down to the automatic resume", () => {
    vi.spyOn(Date, "now").mockReturnValue(31_000);
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />);
    expect(screen.getByText(/Bob paused the game/)).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("30");
  });

  it("lets the player who paused resume early", () => {
    const onResume = vi.fn();
    render(<PauseBar view={{ ...view, youId: "b" }} serverOffset={0} pending={false} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("offers nobody but the pauser a resume button", () => {
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />); // viewer "a" did not pause
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    cleanup();
    render(<PauseBar view={{ ...view, youId: null }} serverOffset={0} pending={false} onResume={() => {}} />);
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/components/PauseBar.test.tsx` → FAIL (no module).

- [ ] **Step 3: Implement `PauseBar.tsx`**, mirroring `TurnTimer`'s interval pattern:

```tsx
"use client";

import { useEffect, useState } from "react";

import type { TableView } from "@/lib/protocol";

type Props = { view: TableView; serverOffset: number; pending: boolean; onResume: () => void };

/** Shown while the game is paused. The server resumes at `until`; this only renders the countdown. */
export function PauseBar({ view, serverOffset, pending, onResume }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const pause = view.pause;
  if (!pause) return null;
  const seconds = Math.max(0, Math.ceil((pause.until - (now + serverOffset)) / 1000));
  const who =
    pause.by === view.youId ? "You" : (view.players.find((p) => p.id === pause.by)?.name ?? "Someone");
  const canResume = view.youId !== null && pause.by === view.youId; // only the player who paused

  return (
    <div className="pause-bar" data-testid="pause-bar">
      <p>
        {who} paused the game. It resumes in{" "}
        <span role="timer" aria-label={`${seconds} seconds until the game resumes`}>
          {seconds}
        </span>
        s.
      </p>
      {canResume && (
        <button type="button" className="button" onClick={onResume} disabled={pending}>
          Resume
        </button>
      )}
    </div>
  );
}
```

Note: the first test expects the timer text to be exactly `30`; the `s.` after it is a sibling text node, so `getByRole("timer").textContent` is `"30"`. The first test's "Bob paused the game" match uses the `<p>` text, which contains it.

- [ ] **Step 4: `TurnTimer`**: add `frozenAt?: number` to `Props` and the destructure; change the remaining calculation to
      `const remainingMs = Math.max(0, deadline - (frozenAt ?? now + serverOffset));`
      (frozenAt is a server time, so it needs no offset). In `Scoreboard.tsx` pass `frozenAt={view.pause?.startedAt}` to `<TurnTimer>`.

- [ ] **Step 5: `TableScreen.tsx`**
  - Import `PauseBar`.
  - `canDismiss`: append `&& !view?.pause`.
  - `myTurn`: append `&& !view.pause`.
  - In `tableBar`, before the Leave button:
    ```tsx
    {
      view.canPause && (
        <button
          type="button"
          className="button-quiet"
          onClick={() => void table.pause()}
          disabled={table.pending}
        >
          Pause (1 min)
        </button>
      );
    }
    ```
  - After the `status-line` paragraph, render `{view.pause && <PauseBar view={view} serverOffset={table.serverOffset} pending={table.pending} onResume={() => void table.resume()} />}` and change the FlipBackBar condition to `view.status === "playing" && view.lockUntil !== null && !view.pause`.
  - `statusText`: first line after the finished/abandoned checks: `if (view.pause) return "Game paused";`
  - `describe`: add cases `"paused"` → `` `${nameOf(view, event.playerId)} paused the game` `` and `"resumed"` → `"Game resumed"` (follow the switch's existing style; if it has a default, keep it).

- [ ] **Step 6: CSS** in `src/app/globals.css` after `.flip-back-hint`: a `.pause-bar` block (margin `0 0 0.75rem`, `font-weight: 700`, `display: grid`, `gap: 0.5rem`), matching existing variable names (`--ink-soft`, `--signal`).

- [ ] **Step 7: Add a TableScreen test** in `TableScreen.test.tsx`: a `playing` view with `pause` set renders `data-testid="pause-bar"` and the status line reads "Game paused"; a view with `canPause: true` shows the "Pause (1 min)" button. Use `mockTable` with a view built the same way as `lobby` (`as unknown as TableView`) with `players: []`, `tiles: []`, `youId: "h"`.

- [ ] **Step 8: Run** `pnpm vitest run src/components` → PASS.

---

### Task 4: Integration test, verification and review

**Files:**

- Test: `tests/integration/table-service.test.ts`

- [ ] **Step 1: Add the integration test** inside `describe("TableService", ...)`, using the existing `startedTable`, `now`, `service`, `alice`, `bob`:

```ts
it("pauses, rejects flips, and resumes by itself on the next poll after the minute", async () => {
  const code = await startedTable();
  const before = (await service.poll(code, bob.playerId, -1)) as SnapshotResponse;
  const deadline = before.view.turn!.deadline;

  now += 2_000;
  const paused = await service.act(code, bob, { type: "pause" }, before.view.seq);
  expect(paused.view.pause).toMatchObject({ by: "g_bob" });
  await expect(service.act(code, alice, { type: "flip", tileId: 0 }, -1)).rejects.toMatchObject({
    code: "paused",
  });

  now += 61_000;
  const after = (await service.poll(code, alice.playerId, paused.view.seq)) as SnapshotResponse;
  expect(after.view.pause).toBeNull();
  expect(after.view.turn!.deadline).toBe(deadline + 60_000);
  expect(after.events.map((e) => e.type)).toEqual(["resumed"]);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/integration/table-service.test.ts` → PASS.

- [ ] **Step 3: Verify.** Use the `verify` skill (`pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`). Fix failures; run `pnpm prettier --write` on the touched files if `format:check` complains.

- [ ] **Step 4: Anti-cheat review.** Run the `anti-cheat-reviewer` agent (the diff touches `src/server/engine/`, `src/lib/protocol/`, `src/app/api/tables/`). Address findings.

- [ ] **Step 5: Docs.** Do not run E2E. Report what is ready to commit; the `sync-docs` skill runs at wrap-up (CLAUDE.md's Map should then mention pause in the engine bullet, and README's architecture/timers section should list the pause rule).
