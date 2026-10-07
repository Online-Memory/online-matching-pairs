# In-game juice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escalating streak visuals (seat glow/flame, `xN` chip, floating score pop-up, scaled confetti burst, streak-broken shake, last-pair and urgent-timer pulses) driven by a new public `streak` field in `PlayerView`.

**Architecture:** The engine already tracks `streak`; `toView` exposes it. A pure `streakTier()` maps it to `none|warm|hot|fire`, and everything visual keys off `data-streak-tier` attributes in CSS. Match effects (pop-up + burst) hang off the `pair_matched` event handling already in `TableScreen`. No migration; nothing hidden leaves the server.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` if touching framework APIs; this plan does not), React, TypeScript, Vitest + Testing Library (jsdom), plain CSS in `src/app/globals.css`, canvas 2D.

**Spec:** `docs/superpowers/specs/2026-10-07-in-game-juice-design.md`

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`; never import server code from components or `src/lib/client`/`src/lib/protocol`.
- The engine stays pure (no I/O, no `Date.now()`); this plan only adds one field to `toView`.
- All animation sits behind `@media (prefers-reduced-motion: no-preference)`; the static `xN` chip stays under reduced motion.
- **No git operations.** CLAUDE.md: git is the user's call. Leave every change uncommitted; there are no commit steps in this plan.
- Run `verify` (lint → format:check → typecheck → test) before declaring done. Do **not** run Playwright/E2E.
- The `anti-cheat-reviewer` agent runs on the final diff (it touches `src/server/engine/`, `src/lib/protocol/`, `Board.tsx`).
- Match existing style: double quotes, 2-space indent, comments only where the "why" is non-obvious (Prettier runs in the Stop hook; `pnpm format` fixes style).

## Review Focus

- A reload, reconnect or spectator must still see the right streak: it comes from `toView`, not from client-side event counting (Task 1 test uses a non-player viewer).
- A later event (e.g. `tile_revealed`) arriving within 1.5s of a match must not strand the pop-up/burst on screen: they clear on their own timer, not the events effect's cleanup (Task 4 test).
- Under `prefers-reduced-motion: reduce` the confetti burst draws nothing (Task 4 test) and the pop-up is hidden by CSS.
- A streak of 3 broken then immediately restarted (3 → 0 → 1) must not leave a stale "broken" chip; and the game ending (status leaves `playing`) must not play the "broken" shake (Task 3 tests).
- A match whose tile element is not in the DOM (e.g. board not laid out) falls back to the viewport centre instead of crashing (Task 4 test); a 1-pair board must not be "last pair" from the start (Task 5 test).

---

### Task 1: Expose `streak` in the player view

**Files:**

- Modify: `src/lib/protocol/index.ts:91` (the `PlayerView` type only; lines 217 and 254 are other types, leave them)
- Modify: `src/server/engine/engine.ts:523`
- Modify (fixtures so typecheck passes): `src/components/Board.test.tsx:21`, `src/lib/client/finish-message.test.ts:16`
- Test: `src/server/engine/engine.test.ts` (inside `describe("toView")`, after the existing `it`)

**Interfaces:**

- Produces: `PlayerView.streak: number`: the player's current consecutive-match count (0 after a miss or timeout). Later tasks read `player.streak`.

- [ ] **Step 1: Write the failing tests**

In `src/server/engine/engine.test.ts`, add inside `describe("toView", ...)`, directly after the first `it(...)`:

```ts
it("exposes the current streak to everyone, and a miss or a timeout resets it", () => {
  let s = started(2, { pairs: 18 });
  const [a, b] = pairOf(s);
  s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
  s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
  const [c, d] = pairOf(s);
  s = act(s, "p1", { type: "flip", tileId: c }, T0 + 3000);
  s = act(s, "p1", { type: "flip", tileId: d }, T0 + 4000);
  // A stranger (not seated) sees it too: it is public, so a reload or a spectator stays correct.
  expect(toView(s, "stranger").players[0]).toMatchObject({ id: "p1", streak: 2, bestStreak: 2 });

  const [m, n] = mismatch(s);
  s = act(s, "p1", { type: "flip", tileId: m }, T0 + 5000);
  s = act(s, "p1", { type: "flip", tileId: n }, T0 + 6000);
  expect(toView(s, "p2").players[0]).toMatchObject({ streak: 0, bestStreak: 2 });
});

it("a turn timeout resets the streak in the view", () => {
  let s = started(2, { pairs: 18 });
  const [a, b] = pairOf(s);
  s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
  s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
  expect(toView(s, "p2").players[0]).toMatchObject({ streak: 1 });
  s = tick(s, T0 + 2000 + 20_000).state; // the fresh 20s turn timer runs out
  expect(toView(s, "p2").players[0]).toMatchObject({ streak: 0, bestStreak: 1 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/server/engine/engine.test.ts -t "streak"`
Expected: FAIL (`streak` is `undefined`, so `toMatchObject` fails).

- [ ] **Step 3: Implement**

`src/lib/protocol/index.ts`, in `PlayerView`, directly above `bestStreak: number;` (line 91):

```ts
/** Consecutive pairs matched right now; 0 after a miss or a timeout. Public. */
streak: number;
```

`src/server/engine/engine.ts`, in `toView`'s player map, directly above `bestStreak: p.bestStreak,` (line 523):

```ts
        streak: p.streak,
```

Fixtures: in `src/components/Board.test.tsx` add `streak: 1,` above `bestStreak: 1,` (line 21); in `src/lib/client/finish-message.test.ts` add `streak: 0,` above `bestStreak: 0,` (line 16).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/server/engine/engine.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean (if typecheck names another `PlayerView` literal missing `streak`, add `streak: 0` there).

---

### Task 2: `streakTier` and burst sizes

**Files:**

- Create: `src/lib/client/streak-tier.ts`
- Test: `src/lib/client/streak-tier.test.ts`

**Interfaces:**

- Produces:
  - `type StreakTier = "none" | "warm" | "hot" | "fire"`
  - `streakTier(streak: number): StreakTier`
  - `BURST_COUNT: Record<StreakTier, number>`: confetti pieces per match.

- [ ] **Step 1: Write the failing test**

`src/lib/client/streak-tier.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BURST_COUNT, streakTier } from "./streak-tier";

describe("streakTier", () => {
  it.each([
    [-1, "none"],
    [0, "none"],
    [1, "none"],
    [2, "warm"],
    [3, "hot"],
    [4, "hot"],
    [5, "fire"],
    [12, "fire"],
  ] as const)("streak %i is %s", (streak, tier) => {
    expect(streakTier(streak)).toBe(tier);
  });

  it("bursts grow with the tier", () => {
    expect(BURST_COUNT.none).toBeLessThan(BURST_COUNT.warm);
    expect(BURST_COUNT.warm).toBeLessThan(BURST_COUNT.hot);
    expect(BURST_COUNT.hot).toBeLessThan(BURST_COUNT.fire);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/client/streak-tier.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/client/streak-tier.ts`:

```ts
export type StreakTier = "none" | "warm" | "hot" | "fire";

/** Streak length → how loud the effects are. CSS keys off the tier, never the raw number. */
export function streakTier(streak: number): StreakTier {
  if (streak >= 5) return "fire";
  if (streak >= 3) return "hot";
  if (streak >= 2) return "warm";
  return "none";
}

/** Confetti pieces for a single match at each tier. */
export const BURST_COUNT: Record<StreakTier, number> = { none: 10, warm: 18, hot: 32, fire: 56 };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/client/streak-tier.test.ts`
Expected: PASS.

---

### Task 3: Streak chip and seat glow on the scoreboard

**Files:**

- Create: `src/components/StreakChip.tsx`
- Modify: `src/components/Scoreboard.tsx`
- Modify: `src/app/globals.css` (append after the `.turn-timer[data-urgent="true"]` rule, ~line 694)
- Test: `src/components/Scoreboard.test.tsx` (new)

**Interfaces:**

- Consumes: `PlayerView.streak` (Task 1); `streakTier`, `StreakTier` (Task 2).
- Produces: `StreakChip({ streak, playing }: { streak: number; playing: boolean })`. Renders `<span className="streak-chip" data-tier=…>x{n}</span>` when `streak >= 2`; for 900ms after a streak of ≥3 falls (while `playing`) renders `data-broken="true"` with the old number; otherwise `null`. Seat `<li>` gets `data-streak-tier="warm|hot|fire"` (attribute absent for `none`).

- [ ] **Step 1: Write the failing tests**

`src/components/Scoreboard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerView, TableView } from "@/lib/protocol";

import { Scoreboard } from "./Scoreboard";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const player = (over: Partial<PlayerView> = {}): PlayerView => ({
  id: "a",
  name: "Ann",
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: 0,
  pairs: 0,
  streak: 0,
  bestStreak: 0,
  rank: null,
  ...over,
});
const view = (players: PlayerView[], status: TableView["status"] = "playing") =>
  ({ status, players, youId: "a", turn: null, lockUntil: null, turnSeconds: 20 }) as unknown as TableView;

const seat = () => screen.getByTestId("seat-Ann");

describe("Scoreboard streaks", () => {
  it("shows nothing below a streak of 2", () => {
    render(<Scoreboard view={view([player({ streak: 1 })])} serverOffset={0} />);
    expect(seat()).not.toHaveAttribute("data-streak-tier");
    expect(screen.queryByText(/^x\d/)).toBeNull();
  });

  it.each([
    [2, "warm"],
    [4, "hot"],
    [6, "fire"],
  ])("streak %i marks the seat %s and shows the chip", (streak, tier) => {
    render(<Scoreboard view={view([player({ streak })])} serverOffset={0} />);
    expect(seat()).toHaveAttribute("data-streak-tier", tier);
    expect(screen.getByText(`x${streak}`)).toHaveAttribute("data-tier", tier);
  });

  it("shakes the old streak for a moment when 3+ is broken, then clears it", () => {
    const { rerender } = render(<Scoreboard view={view([player({ streak: 3 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 0 })])} serverOffset={0} />);
    const chip = screen.getByText("x3");
    expect(chip).toHaveAttribute("data-broken", "true");
    expect(seat()).not.toHaveAttribute("data-streak-tier");
    act(() => void vi.advanceTimersByTime(900));
    expect(screen.queryByText("x3")).toBeNull();
  });

  it("does not shake for a streak of 2 ending", () => {
    const { rerender } = render(<Scoreboard view={view([player({ streak: 2 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 0 })])} serverOffset={0} />);
    expect(screen.queryByText("x2")).toBeNull();
  });

  it("a restarted streak replaces the broken chip", () => {
    const { rerender } = render(<Scoreboard view={view([player({ streak: 3 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 0 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 1 })])} serverOffset={0} />);
    expect(screen.queryByText("x3")).toBeNull();
    act(() => void vi.advanceTimersByTime(900));
    expect(screen.queryByText(/^x\d/)).toBeNull();
  });

  it("shows no streak and no shake once the game is over", () => {
    const { rerender } = render(<Scoreboard view={view([player({ streak: 4 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 4 })], "finished")} serverOffset={0} />);
    expect(seat()).not.toHaveAttribute("data-streak-tier");
    expect(screen.queryByText(/^x\d/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/Scoreboard.test.tsx`
Expected: FAIL (no `data-streak-tier`, no chip).

- [ ] **Step 3: Implement the chip**

`src/components/StreakChip.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { streakTier } from "@/lib/client/streak-tier";

/** A streak this long gets a "broken" moment when it ends. */
const BROKEN_MIN = 3;
const BROKEN_MS = 900;

/**
 * The `xN` badge on a seat. Static information, so it stays under reduced motion; only its shake
 * (CSS) is gated. `playing` is false once the game is over, so the final scores don't "break".
 */
export function StreakChip({ streak, playing }: { streak: number; playing: boolean }) {
  const [broken, setBroken] = useState<number | null>(null);
  const previous = useRef(streak);

  useEffect(() => {
    const before = previous.current;
    previous.current = streak;
    if (!playing || streak >= before || before < BROKEN_MIN) {
      setBroken(null); // a restarted streak or a finished game replaces any broken chip
      return;
    }
    setBroken(before);
    const id = setTimeout(() => setBroken(null), BROKEN_MS);
    return () => clearTimeout(id);
  }, [streak, playing]);

  if (streak >= 2) return <span className="streak-chip" data-tier={streakTier(streak)}>{`x${streak}`}</span>;
  if (broken !== null) return <span className="streak-chip" data-broken="true">{`x${broken}`}</span>;
  return null;
}
```

- [ ] **Step 4: Wire it into `Scoreboard`**

In `src/components/Scoreboard.tsx` add imports:

```tsx
import { streakTier } from "@/lib/client/streak-tier";

import { StreakChip } from "./StreakChip";
```

(keep the existing `TurnTimer` import in the same relative-import group). Inside the `map`, after `const hasTurn = …;` add:

```tsx
const streak = view.status === "playing" ? p.streak : 0;
const tier = streakTier(streak);
```

On the `<li>` add the attribute after `data-status={p.status}`:

```tsx
            data-streak-tier={tier === "none" ? undefined : tier}
```

Inside `<span className="seat-meta">`, as the last child:

```tsx
<StreakChip streak={streak} playing={view.status === "playing"} />
```

- [ ] **Step 5: Add the styles**

Append to `src/app/globals.css` after the `.turn-timer[data-urgent="true"] { … }` rule:

```css
/* Streaks: border colour and the chip are always there; the glow only moves when motion is welcome. */
.streak-chip {
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  line-height: 1.2;
  background: var(--streak-color, var(--signal));
  color: #1b1200;
}

.streak-chip[data-tier="warm"],
.seat[data-streak-tier="warm"] {
  --streak-color: #ffc93c;
}
.streak-chip[data-tier="hot"],
.seat[data-streak-tier="hot"] {
  --streak-color: #ff9f43;
}
.streak-chip[data-tier="fire"],
.seat[data-streak-tier="fire"] {
  --streak-color: #ff5d73;
}

.seat[data-streak-tier] {
  border-color: var(--streak-color);
}

.streak-chip[data-broken="true"] {
  background: var(--line);
  color: var(--ink-soft);
}

@media (prefers-reduced-motion: no-preference) {
  .seat[data-streak-tier="warm"] {
    animation: streak-glow 1.8s ease-in-out infinite;
  }
  .seat[data-streak-tier="hot"] {
    animation: streak-glow 1.1s ease-in-out infinite;
  }
  .seat[data-streak-tier="fire"] {
    animation: streak-glow 0.6s ease-in-out infinite;
  }
  .streak-chip[data-broken="true"] {
    animation: streak-shake 900ms ease-out both;
  }
}

@keyframes streak-glow {
  50% {
    box-shadow:
      0 0 0.9rem 0.1rem color-mix(in srgb, var(--streak-color) 70%, transparent),
      0 0 0.3rem var(--streak-color);
  }
}

@keyframes streak-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  15%,
  45% {
    transform: translateX(-4px) rotate(-6deg);
  }
  30%,
  60% {
    transform: translateX(4px) rotate(6deg);
  }
  80% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run src/components/Scoreboard.test.tsx`
Expected: PASS (all 6 groups). If the lint rule against `setState` in effects objects, mirror the existing pattern in `TableScreen.tsx:59-73` (same technique, already accepted).

---

### Task 4: Score pop-up and match burst

**Files:**

- Modify: `src/components/Confetti.tsx` (extract shared `stepPiece`/`drawPiece`, add `ConfettiBurst`)
- Create: `src/components/ScorePopup.tsx`
- Modify: `src/components/TableScreen.tsx` (imports; state + effects next to the existing `celebrating` effect at ~lines 59-73; render near `<Confetti />` at ~line 251)
- Modify: `src/app/globals.css` (after the `.confetti` rule, ~line 1012)
- Test: `src/components/Confetti.test.tsx` (new), `src/components/TableScreen.test.tsx` (extend)

**Interfaces:**

- Consumes: `streakTier`, `BURST_COUNT`, `StreakTier` (Task 2); `PlayerView.streak` (Task 1).
- Produces:
  - `ConfettiBurst({ x, y, count, delayMs? }: { x: number; y: number; count: number; delayMs?: number })` in `Confetti.tsx`: viewport pixels, decorative, draws nothing under reduced motion.
  - `ScorePopup({ x, y, label, tier }: { x: number; y: number; label: string; tier: StreakTier })` in `ScorePopup.tsx`.

- [ ] **Step 1: Write the failing tests**

`src/components/Confetti.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfettiBurst } from "./Confetti";

const ctx = { setTransform: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: reduce }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConfettiBurst", () => {
  it("starts animating after its delay", () => {
    reducedMotion(false);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(<ConfettiBurst x={10} y={10} count={5} delayMs={300} />);
    vi.advanceTimersByTime(299);
    expect(raf).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when the player prefers reduced motion", () => {
    reducedMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    render(<ConfettiBurst x={10} y={10} count={5} />);
    vi.advanceTimersByTime(1000);
    expect(raf).not.toHaveBeenCalled();
  });
});
```

In `src/components/TableScreen.test.tsx`: change `mockTable` to accept events, and import the event type. Replace the signature/`events: []` pair:

```tsx
function mockTable(view: TableView, events: PublicEvent[] = []) {
  vi.spyOn(tableModule, "useTable").mockReturnValue({
    view,
    serverOffset: 0,
    events,
```

and extend the type import to `import type { MeResponse, PublicEvent, TableView } from "@/lib/protocol";`. Also add `act` and `screen` to the `@testing-library/react` import and `vi` timers are already available. Append a new describe:

```tsx
describe("TableScreen match effects", () => {
  const playing = {
    ...lobby,
    status: "playing",
    youId: "h",
    players: [
      { id: "h", name: "Host", seat: 0, status: "active", isHost: true, isGuest: false, pairs: 3, streak: 3 },
    ],
    turn: { playerId: "h", deadline: 100_000 },
    pause: null,
    canPause: false,
  } as unknown as TableView;
  const started: PublicEvent = { seq: 1, at: 1, type: "turn_changed", playerId: "h", deadline: 100_000 };
  const matched: PublicEvent = { seq: 2, at: 2, type: "pair_matched", playerId: "h", tileIds: [0, 1] };
  const revealed: PublicEvent = { seq: 3, at: 3, type: "tile_revealed", playerId: "h", tileId: 4, face: 2 };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pops the score with the streak when a pair is matched", () => {
    mockTable(playing, [started]);
    const { rerender } = render(<TableScreen code="ABC234" />);
    expect(screen.queryByTestId("score-popup")).toBeNull();
    mockTable(playing, [started, matched]);
    rerender(<TableScreen code="ABC234" />);
    expect(screen.getByTestId("score-popup")).toHaveTextContent("+1 · x3 streak");
    expect(screen.getByTestId("score-popup")).toHaveAttribute("data-tier", "hot");
  });

  it("does not replay history that was already there on first load", () => {
    mockTable(playing, [started, matched]);
    render(<TableScreen code="ABC234" />);
    expect(screen.queryByTestId("score-popup")).toBeNull();
  });

  it("clears the pop-up on its own timer even when a later event arrives first", () => {
    mockTable(playing, [started]);
    const { rerender } = render(<TableScreen code="ABC234" />);
    mockTable(playing, [started, matched]);
    rerender(<TableScreen code="ABC234" />);
    mockTable(playing, [started, matched, revealed]); // next flip lands within the effect window
    rerender(<TableScreen code="ABC234" />);
    expect(screen.getByTestId("score-popup")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.queryByTestId("score-popup")).toBeNull();
  });

  it("says just +1 when there is no streak", () => {
    const single = { ...playing, players: [{ ...playing.players[0]!, streak: 1 }] } as TableView;
    mockTable(single, [started]);
    const { rerender } = render(<TableScreen code="ABC234" />);
    mockTable(single, [started, matched]);
    rerender(<TableScreen code="ABC234" />);
    expect(screen.getByTestId("score-popup")).toHaveTextContent(/^\+1$/);
  });
});
```

(The view's `tiles` is `[]`, so no tile element exists: this also exercises the viewport-centre fallback.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/Confetti.test.tsx src/components/TableScreen.test.tsx`
Expected: FAIL (`ConfettiBurst` is not exported; no `score-popup`).

- [ ] **Step 3: Refactor `Confetti.tsx` and add `ConfettiBurst`**

In `src/components/Confetti.tsx`:

(a) Insert, directly above the `/**\n * Full-screen celebration` doc comment on `export function Confetti()`:

```tsx
/** Advance one piece by `dt` 60fps-frames: drag, gravity, spin. */
function stepPiece(p: Piece, dt: number) {
  p.vx *= Math.pow(DRAG, dt);
  p.vy = Math.min(p.vy * Math.pow(DRAG, dt) + GRAVITY * dt, TERMINAL_VY);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rotation += p.spin * dt;
  p.flip += p.flipSpeed * dt;
  p.age += dt;
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece) {
  const fade = Math.min(1, (p.life - p.age) / 40);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(1, Math.cos(p.flip)); // flutter
  ctx.fillStyle = p.color;
  if (p.shape === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === "ribbon") {
    ctx.fillRect(-p.size * 0.9, -p.size * 0.18, p.size * 1.8, p.size * 0.36);
  } else {
    ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
  }
  ctx.restore();
}
```

(b) Delete the whole `const draw = (p: Piece) => { … };` block inside `Confetti`'s effect (from `const draw = (p: Piece) => {` through its closing `};`), and in `tick` replace

```tsx
for (const p of pieces) {
  p.vx *= Math.pow(DRAG, dt);
  p.vy = Math.min(p.vy * Math.pow(DRAG, dt) + GRAVITY * dt, TERMINAL_VY);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rotation += p.spin * dt;
  p.flip += p.flipSpeed * dt;
  p.age += dt;
  draw(p);
}
```

with

```tsx
for (const p of pieces) {
  stepPiece(p, dt);
  drawPiece(ctx, p);
}
```

(c) Append at the end of the file:

```tsx
type BurstProps = { x: number; y: number; count: number; delayMs?: number };

/**
 * A small radial pop of confetti at a point (viewport pixels) for a single match; `count` grows with
 * the streak tier. Starts after `delayMs` so it lands once the second tile has finished turning over.
 * Purely decorative; draws nothing under reduced motion.
 */
export function ConfettiBurst({ x, y, count, delayMs = 0 }: BurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let pieces: Piece[] = [];
    let last = 0;
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / (1000 / 60), 3);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        stepPiece(p, dt);
        drawPiece(ctx, p);
      }
      pieces = pieces.filter((p) => p.age < p.life);
      if (pieces.length > 0) frame = requestAnimationFrame(tick);
    };

    const timer = setTimeout(() => {
      pieces = Array.from({ length: count }, () => {
        const p = piece(x, y, rand(0, Math.PI * 2), rand(5, 13));
        p.size = rand(5, 9);
        p.life = rand(35, 65);
        return p;
      });
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [x, y, count, delayMs]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden data-testid="confetti-burst" />;
}
```

(`window.matchMedia?.` guards jsdom, which has no `matchMedia`; the existing `Confetti` is untouched in that respect.)

- [ ] **Step 4: Create `ScorePopup`**

`src/components/ScorePopup.tsx`:

```tsx
"use client";

import type { StreakTier } from "@/lib/client/streak-tier";

type Props = { x: number; y: number; label: string; tier: StreakTier };

/** Floats up from where a pair was matched. Hidden by CSS under reduced motion (the seat chip stays). */
export function ScorePopup({ x, y, label, tier }: Props) {
  return (
    <span
      className="score-popup"
      data-tier={tier}
      data-testid="score-popup"
      style={{ left: x, top: y }}
      aria-hidden
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 5: Hook it into `TableScreen`**

Imports in `src/components/TableScreen.tsx`: extend `import { CELEBRATION_MS, Confetti } from "./Confetti";` to `import { CELEBRATION_MS, Confetti, ConfettiBurst } from "./Confetti";`; add `import { ScorePopup } from "./ScorePopup";` (alphabetical among the relative imports) and, with the other `@/lib/client/...` imports, `import { BURST_COUNT, streakTier, type StreakTier } from "@/lib/client/streak-tier";`.

Directly after the existing `celebrating` effect (the one ending `}, [table.events]);`), add:

```tsx
// Score pop-up + confetti burst at the matched pair. The streak comes from the view, which arrives
// in the same response as the event. Its own timer: the events effect above is re-run (and its
// cleanup fires) by any later event, so it must not own this timeout.
type MatchFx = { key: number; x: number; y: number; label: string; tier: StreakTier };
const [matchFx, setMatchFx] = useState<MatchFx | null>(null);
const playersRef = useRef(view?.players);
useEffect(() => {
  playersRef.current = view?.players;
});
const seenFxSeq = useRef<number | null>(null);
useEffect(() => {
  const last = table.events.at(-1);
  if (!last) return;
  const previous = seenFxSeq.current;
  seenFxSeq.current = last.seq;
  if (previous === null) return;
  const matched = table.events.findLast((e) => e.seq > previous && e.type === "pair_matched");
  if (matched?.type !== "pair_matched") return;
  const streak = playersRef.current?.find((p) => p.id === matched.playerId)?.streak ?? 0;
  const tile = document.querySelector<HTMLElement>(`[data-tile-id="${matched.tileIds[1]}"]`);
  const box = tile?.getBoundingClientRect();
  setMatchFx({
    key: matched.seq,
    x: box ? box.left + box.width / 2 : window.innerWidth / 2,
    y: box ? box.top + box.height / 2 : window.innerHeight / 2,
    label: streak >= 2 ? `+1 · x${streak} streak` : "+1",
    tier: streakTier(streak),
  });
}, [table.events]);
useEffect(() => {
  if (!matchFx) return;
  const id = setTimeout(() => setMatchFx(null), 1500);
  return () => clearTimeout(id);
}, [matchFx]);
```

Render, directly before the `{confetti && view && (` block:

```tsx
{
  matchFx && (
    <Fragment key={matchFx.key}>
      <ScorePopup x={matchFx.x} y={matchFx.y} label={matchFx.label} tier={matchFx.tier} />
      <ConfettiBurst x={matchFx.x} y={matchFx.y} count={BURST_COUNT[matchFx.tier]} delayMs={320} />
    </Fragment>
  );
}
```

and add `Fragment` to the existing `react` import in this file (`import { Fragment, … } from "react";`). `320` matches `--flip-duration` in `globals.css:39`; keep them in sync (comment that on the line if the file's style tolerates it).

- [ ] **Step 6: Style the pop-up**

Append to `src/app/globals.css` directly after the `.confetti { … }` rule:

```css
/* "+1 · x3 streak" rising from the matched pair, after the second tile has turned over. */
.score-popup {
  display: none;
  position: fixed;
  z-index: 51;
  pointer-events: none;
  white-space: nowrap;
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--streak-color, #ffc93c);
  text-shadow:
    0 2px 0 rgb(0 0 0 / 0.35),
    0 0 12px rgb(0 0 0 / 0.25);
}
.score-popup[data-tier="warm"] {
  --streak-color: #ffc93c;
}
.score-popup[data-tier="hot"] {
  --streak-color: #ff9f43;
  font-size: 1.85rem;
}
.score-popup[data-tier="fire"] {
  --streak-color: #ff5d73;
  font-size: 2.25rem;
}

@media (prefers-reduced-motion: no-preference) {
  .score-popup {
    display: block;
    animation: score-popup-rise 1000ms ease-out var(--flip-duration) both;
  }
}

@keyframes score-popup-rise {
  0% {
    opacity: 0;
    transform: translate(-50%, -30%) scale(0.6);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, -60%) scale(1.15);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -260%) scale(1);
  }
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm vitest run src/components/Confetti.test.tsx src/components/TableScreen.test.tsx`
Expected: PASS. (jsdom logs "not implemented: getContext" noise only if a test lacks the spy; the `TableScreen` tests render `ConfettiBurst` without a spy; if that noise or a thrown error appears, add `vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)` in that describe's `beforeEach`.)

---

### Task 5: Last-pair and urgent-timer tension

**Files:**

- Modify: `src/components/Board.tsx` (the `.board-area` div, ~line 71)
- Modify: `src/app/globals.css` (after the streak styles from Task 3)
- Test: `src/components/Board.test.tsx` (add `it`s inside the existing `describe("Board")`)

**Interfaces:**

- Produces: `.board-area[data-last-pair="true"]` when exactly two tiles are not yet matched on a board of more than two tiles.

- [ ] **Step 1: Write the failing tests**

Add inside `describe("Board", …)` in `src/components/Board.test.tsx`:

```tsx
it("flags the last pair when exactly two tiles are left unmatched", () => {
  const { container } = render(
    <Board tiles={tiles} theme="001" players={players} canFlip onFlip={() => {}} />,
  );
  expect(container.querySelector(".board-area")).toHaveAttribute("data-last-pair", "true");
});

it("does not flag it while more tiles remain, or on a one-pair board", () => {
  const many: TileView[] = [0, 1, 2, 3].map((id) => ({ id, state: "hidden" }));
  const { container, rerender } = render(
    <Board tiles={many} theme="001" players={players} canFlip onFlip={() => {}} />,
  );
  expect(container.querySelector(".board-area")).not.toHaveAttribute("data-last-pair");
  rerender(<Board tiles={many.slice(0, 2)} theme="001" players={players} canFlip onFlip={() => {}} />);
  expect(container.querySelector(".board-area")).not.toHaveAttribute("data-last-pair");
});
```

(The existing `tiles` fixture has two matched and two unmatched tiles, i.e. a last pair.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/Board.test.tsx -t "last pair"`
Expected: FAIL (attribute missing).

- [ ] **Step 3: Implement**

In `src/components/Board.tsx`, after `const count = tiles.length;` add:

```tsx
// Public information (matched tiles are visible to everyone): two left means the next match ends it.
const lastPair = count > 2 && tiles.filter((t) => t.state !== "matched").length === 2;
```

and change `<div className="board-area" ref={areaRef}>` to:

```tsx
    <div className="board-area" ref={areaRef} data-last-pair={lastPair || undefined}>
```

- [ ] **Step 4: Styles**

Append to `src/app/globals.css` after the streak styles:

```css
/* Tension: the board breathes when one pair is left, and the turn timer throbs in its last 5 seconds. */
@media (prefers-reduced-motion: no-preference) {
  .board-area[data-last-pair="true"] .board {
    animation: last-pair-glow 1.4s ease-in-out infinite;
  }
  .turn-timer[data-urgent="true"] {
    animation: timer-urgent 0.5s ease-in-out infinite alternate;
  }
}

@keyframes last-pair-glow {
  50% {
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--signal) 60%, transparent),
      0 0 2rem var(--signal);
  }
}

@keyframes timer-urgent {
  to {
    transform: scale(1.18);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/components/Board.test.tsx`
Expected: PASS.

---

### Task 6: Verify, review, and align the spec

**Files:**

- Modify: `docs/superpowers/specs/2026-10-07-in-game-juice-design.md` (the "Tension" bullet only)

- [ ] **Step 1: Align the spec with Task 5.** Replace the Tension bullet with:
      `- **Tension:** when two tiles remain the board outline pulses; the `TurnTimer` `data-urgent` state (5 seconds or less) gains a pulse. (`Spotlight` already renders all game, so it is not the last-pair cue.)`

- [ ] **Step 2: Run the `verify` skill** (lint → format:check → typecheck → test). Fix failures; use `pnpm format` for Prettier-only issues. Do not run E2E.

- [ ] **Step 3: Run the `anti-cheat-reviewer` agent** on the diff (touches engine, protocol and `Board.tsx`). Expected: no hidden face reaches the client; `streak` is the only new field.

- [ ] **Step 4: Report** what is ready to commit (no commits made) and that a browser check of the visuals (reduced-motion on and off) is still pending: it needs a human eye.
