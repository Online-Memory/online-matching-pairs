"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/use-me";
import type { LeaderboardEntry, LeaderboardResponse, LeaderboardScope } from "@/lib/protocol";

import { LoadingNotice } from "./Spinner";

function Row({ entry, testId }: { entry: LeaderboardEntry; testId?: string }) {
  return (
    <tr className={entry.isYou ? "you" : undefined} data-testid={testId}>
      <td>{entry.rank}</td>
      <td>
        {entry.name} {entry.handle && <span className="hint">@{entry.handle}</span>}
      </td>
      <td>{entry.rating}</td>
      <td>{entry.ratedGames}</td>
      <td>{entry.wins}</td>
    </tr>
  );
}

export function Leaderboard() {
  const me = useMe();
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.leaderboard(scope).then(
      (data) => !cancelled && setBoard(data),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const choose = (next: LeaderboardScope) => {
    if (next === scope) return;
    setBoard(null);
    setFailed(false);
    setScope(next);
  };

  const pinned = board?.me && !board.entries.some((e) => e.isYou) ? board.me : null;

  return (
    <section className="leaderboard">
      <h1>Leaderboard</h1>
      {me?.user && (
        <div className="leaderboard-tabs">
          {(["global", "friends"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={s === scope ? "button" : "button secondary"}
              aria-pressed={s === scope}
              onClick={() => choose(s)}
            >
              {s === "global" ? "Everyone" : "Friends"}
            </button>
          ))}
        </div>
      )}
      {failed ? (
        <p role="alert">We couldn&apos;t load the leaderboard. Try again in a moment.</p>
      ) : board === null ? (
        <LoadingNotice>Loading the leaderboard…</LoadingNotice>
      ) : board.entries.length === 0 ? (
        <p>No rated games yet. Finish a game with another signed-in player to get on the board.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Rating</th>
              <th scope="col">Games</th>
              <th scope="col">Wins</th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((e) => (
              <Row key={e.rank} entry={e} />
            ))}
            {pinned && <Row entry={pinned} testId="my-row" />}
          </tbody>
        </table>
      )}
    </section>
  );
}
