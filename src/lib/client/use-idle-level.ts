"use client";

import { useEffect, useState } from "react";

import type { TableView } from "@/lib/protocol";

/** 0: fine. 1: the turn is about to end. 2: last call to make a move. */
export type IdleLevel = 0 | 1 | 2;

/** Share of the turn spent doing nothing before each warning: 10s and 15s of a 20s turn. */
const WARN_AT = 0.5;
const NUDGE_AT = 0.75;
/** However late the idle clock restarted, the warnings still arrive this much of the turn before the deadline. */
const WARN_LEAD = 0.25;
const NUDGE_LEAD = 0.1;

type Idle = {
  /** Server time of the last sign of life: the turn starting, or the player flipping a tile. */
  since: number;
  now: number;
  deadline: number;
  turnMs: number;
};

export function idleLevel({ since, now, deadline, turnMs }: Idle): IdleLevel {
  const warnAt = Math.min(since + WARN_AT * turnMs, deadline - WARN_LEAD * turnMs);
  const nudgeAt = Math.min(since + NUDGE_AT * turnMs, deadline - NUDGE_LEAD * turnMs);
  if (now >= nudgeAt) return 2;
  if (now >= warnAt) return 1;
  return 0;
}

/**
 * How long the viewer has sat on their own turn without flipping anything. Only they see it: the
 * server cannot tell idle from thinking, and the real timeout is still the server's.
 */
export function useIdleLevel(view: TableView | null, serverOffset: number): IdleLevel {
  const turn = view?.turn ?? null;
  const mine =
    !!view &&
    view.status === "playing" &&
    view.youId !== null &&
    turn?.playerId === view.youId &&
    turn.deadline !== null &&
    !turn.timedOut &&
    view.lockUntil === null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!mine) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [mine]);

  // Flipping a tile changes how many are face up; that is the one thing that counts as playing.
  // (`now` is at most one tick old while it is the viewer's turn, which is the only time it matters.)
  const revealed = view ? view.tiles.filter((t) => t.state === "revealed").length : 0;
  const [seen, setSeen] = useState({ revealed, at: 0 });
  if (seen.revealed !== revealed) setSeen({ revealed, at: now + serverOffset });

  if (!mine || !view || !turn || turn.deadline === null) return 0;
  const turnMs = view.turnSeconds * 1000;
  return idleLevel({
    // A new turn (or one that resumed after a pause) starts later than the last flip, so it wins.
    since: Math.max(turn.deadline - turnMs, seen.at),
    // The game's clock stands still while paused.
    now: view.pause ? view.pause.startedAt : now + serverOffset,
    deadline: turn.deadline,
    turnMs,
  });
}
