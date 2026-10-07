// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIN_REVEAL_MS, MISMATCH_LOCK_MS, type SnapshotResponse, type TableView } from "@/lib/protocol";

import { ApiError, api } from "./api";
import { useTable } from "./use-table";

const NOW = 1_000_000;
const MISSED_AT = NOW; // the pair was turned over this long ago, in server time

const tiles = (revealed: boolean): TableView["tiles"] => [
  revealed ? { id: 0, state: "revealed", face: 3 } : { id: 0, state: "hidden" },
  revealed ? { id: 1, state: "revealed", face: 4 } : { id: 1, state: "hidden" },
  { id: 2, state: "hidden" },
];

const snapshot = (seq: number, revealed: boolean): SnapshotResponse => ({
  unchanged: false,
  serverNow: Date.now(),
  events: [],
  view: {
    seq,
    status: "playing",
    youId: "me",
    players: [{ id: "me", status: "active" }],
    tiles: tiles(revealed),
    turn: { playerId: "me", deadline: NOW + 60_000 },
    lockUntil: revealed ? MISSED_AT + MISMATCH_LOCK_MS : null,
    pause: null,
  } as unknown as TableView,
});

const revealedIds = (view: TableView | null) =>
  view?.tiles.filter((t) => t.state === "revealed").map((t) => t.id);

async function setup() {
  const poll = vi.spyOn(api, "poll").mockResolvedValue(snapshot(5, true));
  const hook = renderHook(() => useTable("ABC234"));
  await act(async () => {}); // first poll lands
  return { ...hook, poll };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW + 200); // the pair has been face up for 200ms
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTable dismiss", () => {
  it("turns the pair face down at once but only tells the server after the minimum reveal", async () => {
    const dismiss = vi.spyOn(api, "dismiss").mockResolvedValue(snapshot(6, false));
    const { result } = await setup();
    expect(revealedIds(result.current.view)).toEqual([0, 1]);

    act(() => void result.current.dismiss());
    expect(revealedIds(result.current.view)).toEqual([]);
    expect(result.current.view?.tiles[0]).toEqual({ id: 0, state: "hidden" }); // no face leaks back in
    expect(result.current.flippedBack).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(MIN_REVEAL_MS - 200));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(revealedIds(result.current.view)).toEqual([]);
    expect(result.current.flippedBack).toBe(false); // the server's view now agrees
  });

  it("sends straight away when the pair has already been visible long enough", async () => {
    vi.setSystemTime(NOW + MIN_REVEAL_MS + 1);
    const dismiss = vi.spyOn(api, "dismiss").mockResolvedValue(snapshot(6, false));
    const { result } = await setup();
    await act(async () => void result.current.dismiss());
    await act(async () => void vi.advanceTimersByTime(0));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps the tiles down when a stale poll still shows them revealed", async () => {
    vi.spyOn(api, "dismiss").mockResolvedValue(snapshot(6, false));
    const { result, poll } = await setup();
    act(() => void result.current.dismiss());

    poll.mockResolvedValue(snapshot(5, true)); // was already in flight when we flipped back
    await act(async () => void vi.advanceTimersByTime(1_000));
    expect(poll.mock.calls.length).toBeGreaterThan(1);
    expect(revealedIds(result.current.view)).toEqual([]);
  });

  it("only sends one dismissal however often it is clicked", async () => {
    const dismiss = vi.spyOn(api, "dismiss").mockResolvedValue(snapshot(6, false));
    const { result } = await setup();
    act(() => {
      void result.current.dismiss();
      void result.current.dismiss();
    });
    await act(async () => void vi.advanceTimersByTime(MIN_REVEAL_MS));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the server's view again when the dismissal is rejected", async () => {
    vi.spyOn(api, "dismiss").mockRejectedValue(new ApiError("bad_request", "nope", 400));
    const { result } = await setup();
    act(() => void result.current.dismiss());
    await act(async () => void vi.advanceTimersByTime(MIN_REVEAL_MS));
    expect(result.current.actionError).not.toBeNull();
    expect(revealedIds(result.current.view)).toEqual([0, 1]);
    expect(result.current.flippedBack).toBe(false);
  });
});
