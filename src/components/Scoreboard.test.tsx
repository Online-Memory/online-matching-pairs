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

  it("shows nothing when the server does not send a streak (an older server during a deploy)", () => {
    const old = player({ streak: undefined as unknown as number });
    const { rerender } = render(<Scoreboard view={view([old])} serverOffset={0} />);
    rerender(<Scoreboard view={view([old])} serverOffset={0} />);
    expect(seat()).not.toHaveAttribute("data-streak-tier");
    expect(screen.queryByText(/^x/)).toBeNull();
  });

  it("shows no streak and no shake once the game is over", () => {
    const { rerender } = render(<Scoreboard view={view([player({ streak: 4 })])} serverOffset={0} />);
    rerender(<Scoreboard view={view([player({ streak: 4 })], "finished")} serverOffset={0} />);
    expect(seat()).not.toHaveAttribute("data-streak-tier");
    expect(screen.queryByText(/^x\d/)).toBeNull();
  });
});
