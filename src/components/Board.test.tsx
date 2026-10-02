// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayerView, TileView } from "@/lib/protocol";

import { Board } from "./Board";

afterEach(cleanup);

const players: PlayerView[] = [
  {
    id: "a",
    name: "Ann",
    seat: 0,
    status: "active",
    isHost: true,
    isGuest: true,
    moves: 1,
    pairs: 1,
    bestStreak: 1,
    rank: null,
  },
];
const tiles: TileView[] = [
  { id: 0, state: "hidden" },
  { id: 1, state: "revealed", face: 7 },
  { id: 2, state: "matched", face: 3, by: "a" },
  { id: 3, state: "matched", face: 3, by: "a" },
];

describe("Board", () => {
  it("renders pictures only for face-up tiles", () => {
    const { container } = render(
      <Board tiles={tiles} theme="001" players={players} canFlip onFlip={() => {}} />,
    );
    const hidden = screen.getByRole("button", { name: "Tile 1, face down" });
    expect(hidden.querySelector("img")).toBeNull();
    expect(hidden).not.toHaveAttribute("data-face");
    expect(container.querySelectorAll("img")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Tile 2, picture 7" }).querySelector("img")).toHaveAttribute(
      "src",
      "/themes/001/7.webp",
    );
    expect(screen.getByRole("button", { name: "Tile 3, picture 3, matched by Ann" })).toHaveAttribute(
      "data-seat",
      "0",
    );
  });

  it("flips a hidden tile only when allowed", () => {
    const onFlip = vi.fn();
    const { rerender } = render(
      <Board tiles={tiles} theme="001" players={players} canFlip onFlip={onFlip} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tile 1, face down" }));
    fireEvent.click(screen.getByRole("button", { name: "Tile 2, picture 7" }));
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onFlip).toHaveBeenCalledWith(0);

    rerender(<Board tiles={tiles} theme="001" players={players} canFlip={false} onFlip={onFlip} />);
    const hidden = screen.getByRole("button", { name: "Tile 1, face down" });
    expect(hidden).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(hidden);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it("lays the board out in near-square columns", () => {
    const many: TileView[] = Array.from({ length: 24 }, (_, id) => ({ id, state: "hidden" }));
    render(<Board tiles={many} theme="001" players={players} canFlip={false} onFlip={() => {}} />);
    expect(screen.getByRole("group", { name: "Board" }).style.getPropertyValue("--cols")).toBe("6");
  });
});
