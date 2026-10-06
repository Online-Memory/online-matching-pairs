"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Props = { deadline: number; totalSeconds: number; serverOffset: number; frozenAt?: number };

/**
 * Renders the server's deadline. The server alone decides when a turn has actually expired.
 * `frozenAt` (server time) holds the countdown still while the game is paused.
 */
export function TurnTimer({ deadline, totalSeconds, serverOffset, frozenAt }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, deadline - (frozenAt ?? now + serverOffset));
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.min(1, remainingMs / (totalSeconds * 1000));

  return (
    <span
      className="turn-timer"
      data-urgent={seconds <= 5}
      style={{ "--fraction": fraction } as CSSProperties}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      {seconds}
    </span>
  );
}
