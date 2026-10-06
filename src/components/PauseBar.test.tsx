// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TableView } from "@/lib/protocol";

import { PauseBar } from "./PauseBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const view = {
  youId: "a",
  players: [
    { id: "a", name: "Ann", status: "active" },
    { id: "b", name: "Bob", status: "active" },
  ],
  pause: { by: "b", startedAt: 1_000, until: 61_000 },
} as unknown as TableView;

describe("PauseBar", () => {
  it("names who paused and counts down to the automatic resume", () => {
    vi.spyOn(Date, "now").mockReturnValue(31_000);
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />);
    expect(screen.getByText(/Bob paused the game/)).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("30");
  });

  it("drains a progress bar as the pause runs out", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(31_000);
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByTestId("pause-bar-fill").style.transform).toBe("scaleX(0.5)");
    now.mockReturnValue(1_000); // freshly paused: full bar
    cleanup();
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("lets the player who paused resume early", () => {
    const onResume = vi.fn();
    render(<PauseBar view={{ ...view, youId: "b" }} serverOffset={0} pending={false} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onResume).toHaveBeenCalled();
  });

  it("offers nobody but the pauser a resume button", () => {
    render(<PauseBar view={view} serverOffset={0} pending={false} onResume={() => {}} />); // viewer "a" did not pause
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    cleanup();
    render(<PauseBar view={{ ...view, youId: null }} serverOffset={0} pending={false} onResume={() => {}} />);
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });
});
