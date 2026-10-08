// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TableView } from "@/lib/protocol";

import { idleLevel, useIdleLevel } from "./use-idle-level";

const T0 = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("idleLevel", () => {
  const turn = { since: 0, deadline: 20_000, turnMs: 20_000 };

  it("warns at half the turn and nudges at three quarters (10s and 15s of a 20s turn)", () => {
    expect(idleLevel({ ...turn, now: 9_999 })).toBe(0);
    expect(idleLevel({ ...turn, now: 10_000 })).toBe(1);
    expect(idleLevel({ ...turn, now: 14_999 })).toBe(1);
    expect(idleLevel({ ...turn, now: 15_000 })).toBe(2);
  });

  it("scales to short turns", () => {
    const short = { since: 0, deadline: 10_000, turnMs: 10_000 };
    expect(idleLevel({ ...short, now: 4_999 })).toBe(0);
    expect(idleLevel({ ...short, now: 5_000 })).toBe(1);
    expect(idleLevel({ ...short, now: 7_500 })).toBe(2);
  });

  it("never lands later than the deadline allows when the idle clock restarted late in the turn", () => {
    const late = { since: 8_000, deadline: 20_000, turnMs: 20_000 };
    expect(idleLevel({ ...late, now: 14_999 })).toBe(0);
    expect(idleLevel({ ...late, now: 15_000 })).toBe(1);
    expect(idleLevel({ ...late, now: 18_000 })).toBe(2);
  });
});

const tiles = (revealed: number) =>
  Array.from({ length: 4 }, (_, id) => ({ id, state: id < revealed ? "revealed" : "hidden" }));

const view = (over: Record<string, unknown> = {}) =>
  ({
    status: "playing",
    youId: "a",
    turnSeconds: 60,
    turn: { playerId: "a", deadline: T0 + 60_000, timedOut: false },
    lockUntil: null,
    pause: null,
    tiles: tiles(0),
    ...over,
  }) as unknown as TableView;

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("useIdleLevel", () => {
  it("climbs from 0 to 1 to 2 while the player does nothing on their turn", () => {
    const { result } = renderHook(() => useIdleLevel(view(), 0));
    expect(result.current).toBe(0);
    advance(30_000);
    expect(result.current).toBe(1);
    advance(15_000);
    expect(result.current).toBe(2);
  });

  it("starts over when the player flips a tile, with the warnings kept ahead of the deadline", () => {
    const { result, rerender } = renderHook(({ v }) => useIdleLevel(v, 0), { initialProps: { v: view() } });
    advance(30_000);
    expect(result.current).toBe(1);
    rerender({ v: view({ tiles: tiles(1) }) });
    expect(result.current).toBe(0);
    // Half a turn of quiet from the flip would be past the deadline, so the warning comes with 25% of the turn left.
    advance(14_000);
    expect(result.current).toBe(0);
    advance(1_000);
    expect(result.current).toBe(1);
    advance(9_000);
    expect(result.current).toBe(2);
  });

  it("stays 0 when it is not the viewer's turn, nothing is playing, or the turn is held or flipping back", () => {
    for (const v of [
      view({ turn: { playerId: "b", deadline: T0 + 60_000, timedOut: false } }),
      view({ status: "finished" }),
      view({ turn: { playerId: "a", deadline: null, timedOut: true } }),
      view({ lockUntil: T0 + 5_000 }),
      view({ youId: null }),
    ]) {
      const { result, unmount } = renderHook(() => useIdleLevel(v, 0));
      advance(50_000);
      expect(result.current).toBe(0);
      unmount();
    }
  });

  it("holds still while the game is paused", () => {
    const paused = view({ pause: { by: "b", startedAt: T0 + 12_000, until: T0 + 72_000 } });
    const { result } = renderHook(() => useIdleLevel(paused, 0));
    // Time is frozen at the start of the pause (12s into a 60s turn): not yet 30s idle.
    advance(45_000);
    expect(result.current).toBe(0);
  });

  it("has no view yet", () => {
    const { result } = renderHook(() => useIdleLevel(null, 0));
    expect(result.current).toBe(0);
  });
});
