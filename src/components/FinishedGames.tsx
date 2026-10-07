"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { getTheme, type HistoryPage } from "@/lib/protocol";

import { Button } from "./Button";
import { ordinal } from "./Scoreboard";
import { LoadingNotice } from "./Spinner";

const PAGE_SIZE = 10;

export function FinishedGames() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    api.historyPage(page, PAGE_SIZE).then(
      (result) => {
        if (!current) return;
        setData(result);
        setFailed(false);
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [page]);

  // The page being fetched differs from the one on screen; the buttons wait it out.
  const loadingPage = data !== null && data.page !== page;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className="games" aria-labelledby="games-heading">
      <h2 id="games-heading">Finished games</h2>
      {failed && !data ? (
        <p className="notice">Couldn&apos;t load your games.</p>
      ) : data === null ? (
        <LoadingNotice>Loading your games…</LoadingNotice>
      ) : data.total === 0 ? (
        <p>
          No finished games yet. <Link href="/">Set up a table</Link> and play one to the end.
        </p>
      ) : (
        <>
          <ul className="history" data-testid="history" aria-busy={loadingPage}>
            {data.entries.map((game) => {
              const { you } = game;
              const delta =
                you.ratingBefore !== null && you.ratingAfter !== null
                  ? you.ratingAfter - you.ratingBefore
                  : null;
              return (
                <li key={game.code + game.finishedAt} className="game-card">
                  <span className={`game-rank${you.rank === 1 ? " game-rank-win" : ""}`}>
                    {you.rank ? ordinal(you.rank) : "Played"}
                  </span>
                  <div className="game-main">
                    <strong>{getTheme(game.theme)?.name ?? game.theme}</strong>
                    <span>
                      {game.pairs * 2} tiles · {you.pairs} pairs in {you.moves} moves
                    </span>
                    <span className="hint">
                      {game.players.map((p) => (p.isYou ? "you" : p.name)).join(", ")} ·{" "}
                      <time dateTime={game.finishedAt}>{new Date(game.finishedAt).toLocaleDateString()}</time>
                    </span>
                  </div>
                  {delta !== null && (
                    <span
                      className={`game-rating ${delta >= 0 ? "game-rating-up" : "game-rating-down"}`}
                      title={`Rating ${you.ratingBefore} → ${you.ratingAfter}`}
                    >
                      {delta >= 0 ? "▲ +" : "▼ −"}
                      {Math.abs(delta)}
                      <small>
                        {you.ratingBefore} → {you.ratingAfter}
                      </small>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <nav className="pager" aria-label="Finished games pages">
              <Button
                className="button-quiet"
                disabled={page <= 1 || loadingPage}
                pending={loadingPage && page < data.page}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹ Prev
              </Button>
              <span className="hint" aria-live="polite">
                Page {page} of {pages} · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)}{" "}
                of {data.total}
              </span>
              <Button
                className="button-quiet"
                disabled={page >= pages || loadingPage}
                pending={loadingPage && page > data.page}
                onClick={() => setPage((p) => p + 1)}
              >
                Next ›
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
