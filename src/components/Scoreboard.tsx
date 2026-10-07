"use client";

import { streakTier } from "@/lib/client/streak-tier";
import type { TableView } from "@/lib/protocol";

import { StreakChip } from "./StreakChip";
import { TurnTimer } from "./TurnTimer";

type Props = { view: TableView; serverOffset: number };

export function Scoreboard({ view, serverOffset }: Props) {
  return (
    <ol className="scoreboard" aria-label="Players">
      {view.players.map((p) => {
        const hasTurn = view.turn?.playerId === p.id && view.status === "playing";
        const playing = view.status === "playing";
        // `?? 0`: a server from before `streak` existed (a deploy in flight) omits it.
        const streak = playing ? (p.streak ?? 0) : 0;
        const tier = streakTier(streak);
        return (
          <li
            key={p.id}
            className="seat"
            data-seat={p.seat}
            data-turn={hasTurn}
            data-status={p.status}
            data-streak-tier={tier === "none" ? undefined : tier}
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
              <StreakChip streak={streak} playing={playing} />
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
