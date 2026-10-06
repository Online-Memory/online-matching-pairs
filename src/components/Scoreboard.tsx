"use client";

import type { TableView } from "@/lib/protocol";

import { TurnTimer } from "./TurnTimer";

type Props = { view: TableView; serverOffset: number };

export function Scoreboard({ view, serverOffset }: Props) {
  return (
    <ol className="scoreboard" aria-label="Players">
      {view.players.map((p) => {
        const hasTurn = view.turn?.playerId === p.id && view.status === "playing";
        return (
          <li
            key={p.id}
            className="seat"
            data-seat={p.seat}
            data-turn={hasTurn}
            data-status={p.status}
            data-testid={`seat-${p.name}`}
          >
            <span className="seat-token" aria-hidden />
            <span className="seat-name">
              {p.name}
              {p.id === view.youId && <span className="seat-note"> (you)</span>}
            </span>
            <span className="seat-meta">
              {p.isHost && <span>Host</span>}
              {p.status === "away" && <span>Away</span>}
              {p.status === "left" && <span>Left</span>}
              {p.rank !== null && <span>{ordinal(p.rank)}</span>}
            </span>
            <span className="seat-pairs" aria-label={`${p.pairs} pairs`}>
              {p.pairs}
            </span>
            {hasTurn && view.turn && view.lockUntil === null && (
              <TurnTimer
                deadline={view.turn.deadline}
                totalSeconds={view.turnSeconds}
                serverOffset={serverOffset}
                frozenAt={view.pause?.startedAt}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function ordinal(n: number) {
  const suffix =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}
