// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FriendsResponse, MeResponse } from "@/lib/protocol";

import { api, ApiError } from "./api";
import { useFriends, usePresence } from "./use-friends";
import * as meModule from "./use-me";

const empty: FriendsResponse = { handle: "al", friends: [], incoming: [], outgoing: [], invites: [] };
const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "u", name: "U", email: null, image: null },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFriends", () => {
  it("polls every 5 seconds", async () => {
    const spy = vi.spyOn(api, "friends").mockResolvedValue(empty);
    const { result } = renderHook(() => useFriends());
    await waitFor(() => expect(result.current.data).toEqual(empty));
    expect(spy).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not poll without an account", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const spy = vi.spyOn(api, "friends").mockResolvedValue(empty);
    renderHook(() => useFriends());
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the last data and reports the error when a poll fails", async () => {
    const spy = vi
      .spyOn(api, "friends")
      .mockResolvedValueOnce(empty)
      .mockRejectedValue(new ApiError("network", "offline", 0));
    const { result } = renderHook(() => useFriends());
    await waitFor(() => expect(result.current.data).toEqual(empty));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(empty);
    expect(result.current.error).toBe("offline");
  });
});

describe("shared polling", () => {
  it("serves every subscriber from one poll and stops when the last one leaves", async () => {
    const spy = vi.spyOn(api, "friends").mockResolvedValue(empty);
    const first = renderHook(() => useFriends());
    const second = renderHook(() => useFriends());
    await waitFor(() => expect(second.result.current.data).toEqual(empty));
    expect(spy).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy).toHaveBeenCalledTimes(2);

    first.unmount();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy).toHaveBeenCalledTimes(3);

    second.unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale response that resolves after a newer one", async () => {
    const stale: FriendsResponse = { ...empty, handle: "stale" };
    const fresh: FriendsResponse = { ...empty, handle: "fresh" };
    let resolveStale!: (value: FriendsResponse) => void;
    vi.spyOn(api, "friends")
      .mockImplementationOnce(() => new Promise((resolve) => (resolveStale = resolve)))
      .mockResolvedValue(fresh);
    const { result } = renderHook(() => useFriends());
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.data).toEqual(fresh));
    await act(async () => resolveStale(stale));
    expect(result.current.data).toEqual(fresh);
  });
});

describe("usePresence", () => {
  it("beats immediately and every 30 seconds while visible", async () => {
    const spy = vi.spyOn(api, "heartbeat").mockResolvedValue({ handle: "al" });
    renderHook(() => usePresence());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("stays quiet for guests", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const spy = vi.spyOn(api, "heartbeat").mockResolvedValue({ handle: "al" });
    renderHook(() => usePresence());
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(spy).not.toHaveBeenCalled();
  });
});
