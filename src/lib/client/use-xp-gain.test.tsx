// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/lib/protocol";

import { api } from "./api";
import { useXpGain } from "./use-xp-gain";

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const entry = (
  xp: { xpGained?: number | null; xpAfter?: number | null; achievements?: string[] } = {},
): HistoryEntry => ({
  code: "ABC234",
  theme: "001",
  pairs: 8,
  finishedAt: "2026-10-07T12:00:00.000Z",
  you: { pairs: 5, moves: 10, bestStreak: 2, rank: 1, ratingBefore: null, ratingAfter: null, ...xp },
  players: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useXpGain", () => {
  it("finds the gain on a later attempt, once the server has awarded the game", async () => {
    const history = vi
      .spyOn(api, "history")
      .mockResolvedValueOnce([entry({ xpGained: null, xpAfter: null })])
      .mockResolvedValue([entry({ xpGained: 125, xpAfter: 325, achievements: ["first_win"] })]);
    const { result } = renderHook(() => useXpGain("ABC234", true, [100, 200, 300]));
    await advance(100);
    expect(result.current).toBeNull();
    await advance(200);
    expect(result.current).toEqual({ gained: 125, after: 325, achievements: ["first_win"] });
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("treats an older server's missing achievements as none", async () => {
    vi.spyOn(api, "history").mockResolvedValue([entry({ xpGained: 10, xpAfter: 10 })]);
    const { result } = renderHook(() => useXpGain("ABC234", true, [100]));
    await advance(100);
    expect(result.current).toEqual({ gained: 10, after: 10, achievements: [] });
  });

  it("treats fields an older server omits as not awarded yet, and gives up quietly", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry()]);
    const { result } = renderHook(() => useXpGain("ABC234", true, [100, 100]));
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.current).toBeNull();
  });

  it("does nothing when disabled, and stops when unmounted", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry()]);
    renderHook(() => useXpGain("ABC234", false, [100]));
    await advance(1_000);
    expect(history).not.toHaveBeenCalled();
    const { unmount } = renderHook(() => useXpGain("ABC234", true, [100, 100, 100]));
    await advance(100);
    unmount();
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(1);
  });
});
