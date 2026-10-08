// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as tableModule from "@/lib/client/use-table";
import type { MeResponse, PublicEvent, TableView } from "@/lib/protocol";

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
  players: [{ id: "h", name: "Host", seat: 0, colour: 0, status: "active", isHost: true, isGuest: false }],
  tiles: [],
  turn: null,
  lockUntil: null,
} as unknown as TableView;

const join = vi.fn(async (..._args: unknown[]) => {});
const chooseColour = vi.fn(async (..._colour: number[]) => {});
const voteKick = vi.fn(async () => {});

function mockTable(view: TableView, events: PublicEvent[] = []) {
  vi.spyOn(tableModule, "useTable").mockReturnValue({
    view,
    serverOffset: 0,
    events,
    loadError: null,
    actionError: null,
    reconnecting: false,
    pending: false,
    join,
    chooseColour,
    start: vi.fn(),
    flip: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    voteKick,
    leave: vi.fn(),
    clearActionError: vi.fn(),
  } as unknown as tableModule.TableHandle);
}

beforeEach(() => {
  join.mockClear();
  chooseColour.mockClear();
  voteKick.mockClear();
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

describe("TableScreen pause", () => {
  const playing = {
    ...lobby,
    status: "playing",
    youId: "h",
    turn: { playerId: "h", deadline: 100_000 },
    pause: null,
    canPause: false,
  } as unknown as TableView;

  it("offers a Pause button only when the viewer can pause", () => {
    mockTable({ ...playing, canPause: true } as TableView);
    const { getByRole, queryByRole, rerender } = render(<TableScreen code="ABC234" />);
    expect(getByRole("button", { name: "Pause" })).toBeTruthy();
    mockTable(playing);
    rerender(<TableScreen code="ABC234" />);
    expect(queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("shows the pause bar and a paused status while paused", () => {
    mockTable({ ...playing, pause: { by: "h", startedAt: 1_000, until: 61_000 } } as TableView);
    const { getByTestId } = render(<TableScreen code="ABC234" />);
    expect(getByTestId("pause-bar")).toBeTruthy();
    expect(getByTestId("status-line").textContent).toBe("Game paused");
  });

  it("fades the board, makes it inert and announces the pause over it", () => {
    mockTable({ ...playing, pause: { by: "h", startedAt: 1_000, until: 61_000 } } as TableView);
    const { getByTestId, getByRole } = render(<TableScreen code="ABC234" />);
    expect(getByTestId("board-paused").textContent).toBe("Game Paused");
    expect(getByRole("group", { name: "Board" }).getAttribute("data-paused")).toBe("true");
  });
});

describe("TableScreen match effects", () => {
  const playing = {
    ...lobby,
    status: "playing",
    youId: "h",
    players: [
      {
        id: "h",
        name: "Host",
        seat: 0,
        colour: 0,
        status: "active",
        isHost: true,
        isGuest: false,
        pairs: 3,
        streak: 3,
      },
    ],
    turn: { playerId: "h", deadline: 100_000 },
    pause: null,
    canPause: false,
  } as unknown as TableView;
  const started: PublicEvent = { seq: 1, at: 1, type: "turn_changed", playerId: "h", deadline: 100_000 };
  const matched: PublicEvent = { seq: 2, at: 2, type: "pair_matched", playerId: "h", tileIds: [0, 1] };
  const revealed: PublicEvent = { seq: 3, at: 3, type: "tile_revealed", playerId: "h", tileId: 4, face: 2 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
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
    act(() => void vi.advanceTimersByTime(2999)); // long enough to read: it holds for about 2.5s
    expect(screen.getByTestId("score-popup")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
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

describe("TableScreen kick vote", () => {
  it("shows the vote button for a held turn and calls voteKick", () => {
    mockTable({
      ...lobby,
      status: "playing",
      youId: "b",
      players: [
        { id: "a", name: "Ann", seat: 0, colour: 0, status: "active", isHost: true, isGuest: false },
        { id: "b", name: "Bob", seat: 1, colour: 1, status: "active", isHost: false, isGuest: false },
      ],
      turn: { playerId: "a", deadline: null, timedOut: true },
      kickVote: { targetId: "a", votes: 0, needed: 1, youVoted: false },
      canVoteKick: true,
      pause: null,
      canPause: false,
    } as unknown as TableView);
    render(<TableScreen code="ABC234" />);
    expect(screen.getByTestId("status-line").textContent).toBe("Ann ran out of time");
    fireEvent.click(screen.getByRole("button", { name: "Vote to kick Ann" }));
    expect(voteKick).toHaveBeenCalledOnce();
  });
});

describe("TableScreen turn cue", () => {
  const myTurn = {
    ...lobby,
    status: "playing",
    youId: "h",
    turn: { playerId: "h", deadline: Date.now() + 60_000, timedOut: false },
    turnSeconds: 60,
    lockUntil: null,
    pause: null,
    canPause: false,
  } as unknown as TableView;

  it("tells the player on the clock that it is their turn", () => {
    mockTable(myTurn);
    const { getByTestId } = render(<TableScreen code="ABC234" />);
    expect(getByTestId("board-cue").textContent).toBe("It's your turn");
  });

  it("shows no cue on someone else's turn or while the turn is held for a vote", () => {
    mockTable({
      ...myTurn,
      turn: { playerId: "g", deadline: Date.now() + 60_000, timedOut: false },
    } as TableView);
    const { queryByTestId, rerender } = render(<TableScreen code="ABC234" />);
    expect(queryByTestId("board-cue")).toBeNull();
    mockTable({ ...myTurn, turn: { playerId: "h", deadline: null, timedOut: true } } as TableView);
    rerender(<TableScreen code="ABC234" />);
    expect(queryByTestId("board-cue")).toBeNull();
  });
});

describe("TableScreen colours", () => {
  it("sends a seated player's colour switch to the table", () => {
    mockTable({ ...lobby, youId: "h" });
    render(<TableScreen code="ABC234" />);
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    expect(chooseColour).toHaveBeenCalledWith(10);
  });

  it("sends a guest's name and colour when they join", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(guest);
    mockTable(lobby);
    render(<TableScreen code="ABC234" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cat" } });
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    fireEvent.click(screen.getByRole("button", { name: "Join table" }));
    expect(join).toHaveBeenCalledWith("Cat", 10);
  });
});
