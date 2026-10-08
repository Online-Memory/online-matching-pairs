// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BoardCue } from "./BoardCue";

afterEach(cleanup);

describe("BoardCue", () => {
  it("says it is the player's turn", () => {
    render(<BoardCue level={0} />);
    expect(screen.getByTestId("board-cue").textContent).toBe("It's your turn");
  });

  it("warns that the turn is about to end", () => {
    render(<BoardCue level={1} />);
    expect(screen.getByTestId("board-cue").textContent).toBe("Your turn is about to end");
  });

  it("asks the player to move before the timer runs out", () => {
    render(<BoardCue level={2} />);
    expect(screen.getByTestId("board-cue").textContent).toBe(
      "Make your move before the turn timer runs out!",
    );
  });

  it("announces only the warnings to assistive tech; the plain cue duplicates the status line", () => {
    const { rerender } = render(<BoardCue level={0} />);
    expect(screen.getByTestId("board-cue").getAttribute("aria-hidden")).toBe("true");
    rerender(<BoardCue level={1} />);
    expect(screen.getByTestId("board-cue").getAttribute("aria-hidden")).toBeNull();
    expect(screen.getByTestId("board-cue").getAttribute("aria-live")).toBe("polite");
  });
});
