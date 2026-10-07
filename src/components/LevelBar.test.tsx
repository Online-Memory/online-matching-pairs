// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LevelBar } from "./LevelBar";

afterEach(cleanup);

describe("LevelBar", () => {
  it("shows the level and the progress through it", () => {
    render(<LevelBar progress={{ xp: 150, level: 2, xpIntoLevel: 50, xpForNext: 200 }} />);
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("50 / 200 XP")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
  });
});
