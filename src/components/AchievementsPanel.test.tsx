// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ACHIEVEMENTS } from "@/lib/progress/achievements";

import { AchievementsPanel } from "./AchievementsPanel";

afterEach(cleanup);

describe("AchievementsPanel", () => {
  it("lists every achievement, unlocked ones marked and the rest locked", () => {
    render(<AchievementsPanel earned={[{ id: "first_game", earnedAt: "2026-10-07T12:00:00.000Z" }]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ACHIEVEMENTS.length);
    const first = screen.getByText("First game").closest("li")!;
    expect(first).toHaveAttribute("data-earned", "true");
    expect(within(first).getByText(/Earned/)).toBeInTheDocument();
    expect(screen.getByText("Flawless").closest("li")).toHaveAttribute("data-earned", "false");
  });

  it("shows everything locked when nothing is earned, and ignores ids it does not know", () => {
    render(<AchievementsPanel earned={[{ id: "from_the_future", earnedAt: "2026-10-07T12:00:00.000Z" }]} />);
    expect(screen.getAllByRole("listitem").every((li) => li.getAttribute("data-earned") === "false")).toBe(
      true,
    );
    expect(screen.getByText("0 of 7 earned")).toBeInTheDocument();
  });
});
