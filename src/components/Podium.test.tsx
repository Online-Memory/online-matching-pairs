// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlayerView } from "@/lib/protocol";

import { Podium } from "./Podium";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
});
afterEach(cleanup);

const player = (id: string, rank: number, pairs: number): PlayerView => ({
  id,
  name: id.toUpperCase(),
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: pairs,
  pairs,
  streak: 0,
  bestStreak: 0,
  rank,
});

const places = () => [...screen.getByTestId("podium").children].map((el) => el.getAttribute("data-place"));

describe("Podium", () => {
  it("puts first place in the middle of three steps", () => {
    render(<Podium players={[player("a", 1, 6), player("b", 2, 4), player("c", 3, 2), player("d", 4, 1)]} />);
    expect(places()).toEqual(["2", "1", "3"]);
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("A");
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("6");
    expect(screen.queryByText("D")).toBeNull(); // fourth place is not on the podium
  });

  it("shares a step on a tie, and the next group takes the next step", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 1, 5), player("c", 3, 2)]} />);
    expect(places()).toEqual(["2", "1"]);
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("A");
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("B");
    expect(screen.getByTestId("podium-step-2")).toHaveTextContent("C");
  });

  it("shows two steps for a two-player game", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 2, 3)]} />);
    expect(places()).toEqual(["2", "1"]);
  });

  it("renders nothing for a solo game", () => {
    const { container } = render(<Podium players={[player("a", 1, 8)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden from assistive tech, the results table carries the same facts", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 2, 3)]} />);
    expect(screen.getByTestId("podium")).toHaveAttribute("aria-hidden", "true");
  });
});
