// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TableView } from "@/lib/protocol";

import { KickVoteBar } from "./KickVoteBar";

afterEach(cleanup);

const view = (over: Partial<TableView> = {}) =>
  ({
    youId: "b",
    players: [
      { id: "a", name: "Ann", status: "active" },
      { id: "b", name: "Bob", status: "active" },
      { id: "c", name: "Cy", status: "active" },
    ],
    kickVote: { targetId: "a", votes: 1, needed: 2, youVoted: false },
    canVoteKick: true,
    ...over,
  }) as unknown as TableView;

describe("KickVoteBar", () => {
  it("renders nothing when no turn is held", () => {
    const { container } = render(
      <KickVoteBar view={view({ kickVote: null })} pending={false} onVote={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the tally and lets an eligible voter vote", () => {
    const onVote = vi.fn();
    render(<KickVoteBar view={view()} pending={false} onVote={onVote} />);
    expect(screen.getByText(/Ann ran out of time/)).toBeTruthy();
    expect(screen.getByTestId("kick-tally").textContent).toBe("1/2");
    fireEvent.click(screen.getByRole("button", { name: "Vote to kick Ann" }));
    expect(onVote).toHaveBeenCalledOnce();
  });

  it("hides the button once the viewer has voted", () => {
    render(
      <KickVoteBar
        view={view({ canVoteKick: false, kickVote: { targetId: "a", votes: 1, needed: 2, youVoted: true } })}
        pending={false}
        onVote={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/You voted/)).toBeTruthy();
  });

  it("tells the timed-out player how to carry on, with no vote button", () => {
    render(<KickVoteBar view={view({ youId: "a", canVoteKick: false })} pending={false} onVote={() => {}} />);
    expect(screen.getByText(/Flip a tile to carry on/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
