// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/lib/protocol";

import { api } from "./api";
import { useRatingChange } from "./use-rating-change";

/** Advances fake time inside act(), so state updates from the hook are flushed before we read them. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const entry = (ratingBefore: number | null, ratingAfter: number | null): HistoryEntry => ({
  code: "ABC234",
  theme: "001",
  pairs: 8,
  finishedAt: "2026-10-06T12:00:00.000Z",
  you: { pairs: 5, moves: 10, bestStreak: 2, rank: 1, ratingBefore, ratingAfter },
  players: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRatingChange", () => {
  it("finds the change on a later attempt, once the server has rated the game", async () => {
    const history = vi
      .spyOn(api, "history")
      .mockResolvedValueOnce([entry(null, null)])
      .mockResolvedValue([entry(1000, 1024)]);
    const { result } = renderHook(() => useRatingChange("ABC234", true, [100, 200, 300]));
    expect(result.current).toBeNull();
    await advance(100);
    expect(result.current).toBeNull();
    await advance(200);
    expect(result.current).toEqual({ before: 1000, after: 1024 });
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly after the last attempt", async () => {
    const history = vi.spyOn(api, "history").mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useRatingChange("ABC234", true, [100, 100]));
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.current).toBeNull();
  });

  it("does nothing when disabled", async () => {
    const history = vi.spyOn(api, "history");
    renderHook(() => useRatingChange("ABC234", false, [100]));
    await advance(1_000);
    expect(history).not.toHaveBeenCalled();
  });

  it("stops polling when unmounted", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry(null, null)]);
    const { unmount } = renderHook(() => useRatingChange("ABC234", true, [100, 100, 100]));
    await advance(100);
    unmount();
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(1);
  });
});
