"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Props = { deadline: number; totalSeconds: number; serverOffset: number };

/** Renders the server's deadline. The server alone decides when a turn has actually expired. */
export function TurnTimer({ deadline, totalSeconds, serverOffset }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, deadline - (now + serverOffset));
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
