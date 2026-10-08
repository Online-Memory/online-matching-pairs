// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TableView } from "@/lib/protocol";

import { Lobby } from "./Lobby";

vi.mock("./InviteFriends", () => ({ InviteFriends: () => null }));
afterEach(cleanup);

const players = [
  { id: "h", name: "Host", seat: 0, colour: 0, status: "active", isHost: true, isGuest: false },
  { id: "b", name: "Bob", seat: 1, colour: 4, status: "active", isHost: false, isGuest: true },
];
const view = (over: Partial<TableView> = {}) =>
  ({
    code: "ABC234",
    theme: "001",
    pairs: 8,
    maxPlayers: 4,
    turnSeconds: 20,
    status: "lobby",
    hostId: "h",
    youId: null,
    players,
    ...over,
  }) as unknown as TableView;

const props = () => ({
  needsName: false,
  pending: false,
  pendingAction: null,
  onJoin: vi.fn(),
  onStart: vi.fn(),
  onLeave: vi.fn(),
  onChooseColour: vi.fn(),
});

describe("Lobby colours", () => {
  it("lists players in their own colour", () => {
    render(<Lobby view={view()} {...props()} />);
    const items = within(screen.getByRole("list", { name: "Seated players" })).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-seat", "0");
    expect(items[1]).toHaveAttribute("data-seat", "4");
  });

  it("lets a seated player switch to a free colour, with others' colours disabled", () => {
    const p = props();
    render(<Lobby view={view({ youId: "b" })} {...p} />);
    const picker = screen.getByRole("radiogroup", { name: "Your colour" });
    expect(within(picker).getByRole("radio", { name: "Wine" })).toBeChecked();
    expect(within(picker).getByRole("radio", { name: "Olive" })).toBeDisabled();
    fireEvent.click(within(picker).getByRole("radio", { name: "Navy" }));
    expect(p.onChooseColour).toHaveBeenCalledWith(10);
  });

  it("shows a guest the lowest free colour preselected but sends no colour unless they pick one", () => {
    const p = props();
    render(<Lobby view={view()} {...p} needsName />);
    const picker = screen.getByRole("radiogroup", { name: "Pick your colour" });
    expect(within(picker).getByRole("radio", { name: "Brown" })).toBeChecked();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cat" } });
    fireEvent.click(screen.getByRole("button", { name: "Join table" }));
    // The server picks the lowest free colour at join time, so a friend who joined a second earlier can't make this fail.
    expect(p.onJoin).toHaveBeenCalledWith("Cat", undefined);
  });

  it("sends the colour a guest picked", () => {
    const p = props();
    render(<Lobby view={view()} {...p} needsName />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cat" } });
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    fireEvent.click(screen.getByRole("button", { name: "Join table" }));
    expect(p.onJoin).toHaveBeenCalledWith("Cat", 10);
  });

  it("moves a guest's selection to a free colour when theirs is taken meanwhile", () => {
    const p = props();
    const { rerender } = render(<Lobby view={view()} {...p} needsName />);
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    expect(screen.getByRole("radio", { name: "Navy" })).toBeChecked();
    const taken = [
      ...players,
      { id: "c", name: "Cy", seat: 2, colour: 10, status: "active", isHost: false, isGuest: true },
    ];
    rerender(<Lobby view={view({ players: taken as never })} {...p} needsName />);
    expect(screen.getByRole("radio", { name: "Navy" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Brown" })).toBeChecked();
  });

  it("shows a signed-in visitor no picker and joins on their saved preferences", () => {
    const p = props();
    render(<Lobby view={view()} {...p} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Join table" }));
    expect(p.onJoin).toHaveBeenCalledWith();
  });
});
