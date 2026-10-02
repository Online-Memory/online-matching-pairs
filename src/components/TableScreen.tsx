"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useMe } from "@/lib/client/use-me";
import { useTable } from "@/lib/client/use-table";
import type { PublicEvent, TableView } from "@/lib/protocol";

import { Board } from "./Board";
import { Lobby } from "./Lobby";
import { Results } from "./Results";
import { Scoreboard } from "./Scoreboard";

export function TableScreen({ code }: { code: string }) {
  const table = useTable(code);
  const me = useMe();
  const { view, actionError, clearActionError } = table;

  useEffect(() => {
    if (!actionError) return;
    const id = setTimeout(clearActionError, 3500);
    return () => clearTimeout(id);
  }, [actionError, clearActionError]);

  if (table.loadError?.code === "not_found") {
    return (
      <main className="page page-narrow">
        <h1>No table called {code}</h1>
        <p>Check the code with whoever invited you, or set up a new table.</p>
        <Link className="button" href="/">
          Set up a table
        </Link>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="page page-narrow" aria-busy>
        <p className="notice">{table.loadError ? table.loadError.message : `Opening table ${code}…`}</p>
      </main>
    );
  }

  const you = view.players.find((p) => p.id === view.youId);
  const myTurn = view.status === "playing" && view.turn?.playerId === view.youId && view.lockUntil === null;
  const revealedCount = view.tiles.filter((t) => t.state === "revealed").length;
  const canFlip = myTurn && revealedCount < 2 && !table.pending;

  return (
    <main className="page table-page" data-status={view.status} data-my-turn={myTurn}>
      <header className="table-bar">
        <h1 className="table-title">
          Table <span data-testid="table-code-bar">{view.code}</span>
        </h1>
        {table.reconnecting && <span className="pill">Reconnecting…</span>}
        {view.status === "playing" && you && you.status !== "left" && (
          <button
            type="button"
            className="button-quiet"
            onClick={() => void table.leave()}
            disabled={table.pending}
          >
            Leave game
          </button>
        )}
      </header>

      {view.status === "lobby" ? (
        <Lobby
          view={view}
          needsName={me !== null && !me.user}
          pending={table.pending}
          onJoin={(name) => void table.join(name)}
          onStart={() => void table.start()}
          onLeave={() => void table.leave()}
        />
      ) : (
        <>
          <Scoreboard view={view} serverOffset={table.serverOffset} />
          <p className="status-line" role="status" data-testid="status-line">
            {statusText(view, myTurn)}
          </p>
          {you?.status === "away" && view.status === "playing" && (
            <div className="away-banner">
              <p>You missed three turns in a row, so your turns are being skipped.</p>
              <button
                type="button"
                className="button"
                onClick={() => void table.join()}
                disabled={table.pending}
              >
                I&apos;m back
              </button>
            </div>
          )}
          {view.status === "finished" && <Results view={view} />}
          {view.status === "abandoned" && (
            <div className="notice-block">
              <p>This game ended because everyone left or stopped playing.</p>
              <Link className="button" href="/">
                Set up a new table
              </Link>
            </div>
          )}
          <Board
            tiles={view.tiles}
            theme={view.theme}
            players={view.players}
            canFlip={canFlip}
            onFlip={(id) => void table.flip(id)}
          />
          <p className="activity" aria-live="polite">
            {describe(table.events.at(-1), view)}
          </p>
        </>
      )}

      {actionError && (
        <p className="toast" role="alert">
          {actionError.message}
        </p>
      )}
    </main>
  );
}

function nameOf(view: TableView, playerId: string) {
  return playerId === view.youId ? "You" : (view.players.find((p) => p.id === playerId)?.name ?? "Someone");
}

function statusText(view: TableView, myTurn: boolean) {
  if (view.status === "finished") return "Game over";
  if (view.status === "abandoned") return "Game abandoned";
  if (!view.youId && view.status === "playing") return "You're watching this game";
  if (view.lockUntil !== null) return "No match. Flipping back…";
  if (!view.turn) return "Waiting for players to come back";
  if (myTurn) return "Your turn. Flip two tiles.";
  return `${nameOf(view, view.turn.playerId)}'s turn`;
}

function describe(event: PublicEvent | undefined, view: TableView): string {
  if (!event) return "";
  switch (event.type) {
    case "pair_matched":
      return `${nameOf(view, event.playerId)} found a pair`;
    case "pair_missed":
      return `${nameOf(view, event.playerId)} missed`;
    case "turn_timed_out":
      return `${nameOf(view, event.playerId)} ran out of time`;
    case "player_away":
      return `${nameOf(view, event.playerId)} is away`;
    case "player_returned":
      return `${nameOf(view, event.playerId)} is back`;
    case "player_left":
      return `${nameOf(view, event.playerId)} left the game`;
    case "host_changed":
      return `${nameOf(view, event.playerId)} is now the host`;
    default:
      return "";
  }
}
