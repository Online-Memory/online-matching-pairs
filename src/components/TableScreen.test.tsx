// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as tableModule from "@/lib/client/use-table";
import type { MeResponse, TableView } from "@/lib/protocol";

import { TableScreen } from "./TableScreen";

const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "a", name: "Alice", email: null, image: null },
};
const guest: MeResponse = { authEnabled: true, user: null };

const lobby = {
  code: "ABC234",
  theme: "animals",
  pairs: 8,
  maxPlayers: 4,
  turnSeconds: 20,
  isPublic: false,
  tableName: "Test table",
  status: "lobby",
  hostId: "h",
  youId: null,
  players: [{ id: "h", name: "Host", seat: 0, status: "active", isHost: true, isGuest: false }],
  tiles: [],
  turn: null,
  lockUntil: null,
} as unknown as TableView;

const join = vi.fn(async () => {});

function mockTable(view: TableView) {
  vi.spyOn(tableModule, "useTable").mockReturnValue({
    view,
    serverOffset: 0,
    events: [],
    loadError: null,
    actionError: null,
    reconnecting: false,
    pending: false,
    join,
    start: vi.fn(),
    flip: vi.fn(),
    dismiss: vi.fn(),
    leave: vi.fn(),
    clearActionError: vi.fn(),
  } as unknown as tableModule.TableHandle);
}

beforeEach(() => {
  join.mockClear();
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TableScreen auto-join", () => {
  it("seats a signed-in visitor who arrived from an invite, once", () => {
    mockTable(lobby);
    const { rerender } = render(<TableScreen code="ABC234" autoJoin />);
    rerender(<TableScreen code="ABC234" autoJoin />);
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the invite flag", () => {
    mockTable(lobby);
    render(<TableScreen code="ABC234" />);
    expect(join).not.toHaveBeenCalled();
  });

  it("does not join someone already seated, or a game already under way", () => {
    mockTable({ ...lobby, youId: "h" });
    render(<TableScreen code="ABC234" autoJoin />);
    cleanup();
    mockTable({ ...lobby, status: "playing" });
    render(<TableScreen code="ABC234" autoJoin />);
    expect(join).not.toHaveBeenCalled();
  });

  it("leaves guests to pick a name and press Join", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(guest);
    mockTable(lobby);
    render(<TableScreen code="ABC234" autoJoin />);
    expect(join).not.toHaveBeenCalled();
  });
});
