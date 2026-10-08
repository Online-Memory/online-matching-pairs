"use client";

import type { TableView } from "@/lib/protocol";

import { Button } from "./Button";

type Props = { view: TableView; pending: boolean; onVote: () => void };

/** Shown while a timed-out turn is held. Everyone sees the tally; players who can vote get the button. */
export function KickVoteBar({ view, pending, onVote }: Props) {
  const vote = view.kickVote;
  if (!vote) return null;
  const isTarget = vote.targetId === view.youId;
  const name = view.players.find((p) => p.id === vote.targetId)?.name ?? "Someone";

  return (
    <div className="kick-bar" data-testid="kick-bar">
      {isTarget ? (
        <p>
          Your turn timed out. Flip a tile to carry on, or the other players can vote you out of this game.
        </p>
      ) : (
        <p>
          {name} ran out of time. Votes to kick:{" "}
          <span data-testid="kick-tally">
            {vote.votes}/{vote.needed}
          </span>
        </p>
      )}
      {view.canVoteKick && (
        <Button onClick={onVote} pending={pending}>
          Vote to kick {name}
        </Button>
      )}
      {!isTarget && vote.youVoted && <p>You voted. Waiting for the others.</p>}
    </div>
  );
}
