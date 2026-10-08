"use client";

import { streakTier } from "@/lib/client/streak-tier";
import type { IdleLevel } from "@/lib/client/use-idle-level";
import type { TableView } from "@/lib/protocol";

import { StreakChip } from "./StreakChip";
import { TurnTimer } from "./TurnTimer";

type Props = { view: TableView; serverOffset: number; idleLevel?: IdleLevel };

export function Scoreboard({ view, serverOffset, idleLevel = 0 }: Props) {
  return (
    <ol className="scoreboard" aria-label="Players">
      {view.players.map((p) => {
        const hasTurn = view.turn?.playerId === p.id && view.status === "playing";
        const playing = view.status === "playing";
        // Only the player on the clock can be idle, and only their own screen knows it.
        const idle = hasTurn && p.id === view.youId ? idleLevel : 0;
        // `?? 0`: a server from before `streak` existed (a deploy in flight) omits it.
        const streak = playing ? (p.streak ?? 0) : 0;
        const tier = streakTier(streak);
        return (
          <li
            key={p.id}
            className="seat"
            data-seat={p.colour}
            data-turn={hasTurn}
            data-you={p.id === view.youId || undefined}
            data-idle={idle > 0 ? idle : undefined}
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
              {p.status === "kicked" && <span>Kicked</span>}
              {p.rank !== null && <span>{ordinal(p.rank)}</span>}
              <StreakChip streak={streak} playing={playing} />
            </span>
            <span className="seat-pairs" aria-label={`${p.pairs} pairs`}>
              {p.pairs}
            </span>
            {hasTurn && view.turn && view.turn.deadline !== null && view.lockUntil === null && (
              <TurnTimer
                deadline={view.turn.deadline}
                totalSeconds={view.turnSeconds}
                serverOffset={serverOffset}
                frozenAt={view.pause?.startedAt}
                urgent={idle > 0}
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
