// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayerView, SnapshotResponse, TableView } from "@/lib/protocol";

import { getActiveTable } from "./active-table";
import { api } from "./api";
import { useTable } from "./use-table";

const player = (id: string, status: PlayerView["status"] = "active") => ({ id, status }) as PlayerView;
const snapshot = (view: Partial<TableView>): SnapshotResponse => ({
  unchanged: false,
  serverNow: Date.now(),
  events: [],
  view: { seq: 1, status: "lobby", youId: "me", players: [player("me")], ...view } as TableView,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useTable reports where we sit", () => {
  it("while seated in a lobby, and clears it on unmount", async () => {
    vi.spyOn(api, "poll").mockResolvedValue(snapshot({}));
    const { unmount } = renderHook(() => useTable("ABC234"));
    await waitFor(() => expect(getActiveTable()).toBe("ABC234"));
    unmount();
    expect(getActiveTable()).toBeNull();
  });

  it("not when only watching", async () => {
    const poll = vi.spyOn(api, "poll").mockResolvedValue(snapshot({ youId: null }));
    renderHook(() => useTable("ABC234"));
    await waitFor(() => expect(poll).toHaveBeenCalled());
    await act(async () => {});
    expect(getActiveTable()).toBeNull();
  });

  it("not after we left", async () => {
    vi.spyOn(api, "poll").mockResolvedValue(snapshot({ players: [player("me", "left")] }));
    renderHook(() => useTable("ABC234"));
    await act(async () => {});
    expect(getActiveTable()).toBeNull();
  });

  it("not once the game has finished", async () => {
    vi.spyOn(api, "poll")
      .mockResolvedValueOnce(snapshot({ status: "playing" }))
      .mockResolvedValue(snapshot({ seq: 2, status: "finished" }));
    const { result } = renderHook(() => useTable("ABC234"));
    await waitFor(() => expect(getActiveTable()).toBe("ABC234"));
    await act(async () => {
      await result.current.dismiss().catch(() => {});
    });
    await waitFor(() => expect(getActiveTable()).toBeNull());
  });
});
