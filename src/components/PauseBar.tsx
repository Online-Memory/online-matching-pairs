"use client";

import { useEffect, useState } from "react";

import type { TableView } from "@/lib/protocol";

import { Button } from "./Button";

type Props = { view: TableView; serverOffset: number; pending: boolean; onResume: () => void };

/** Shown while the game is paused. The server resumes at `until`; this only renders the countdown. */
export function PauseBar({ view, serverOffset, pending, onResume }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const pause = view.pause;
  if (!pause) return null;
  const remainingMs = Math.max(0, pause.until - (now + serverOffset));
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = Math.min(1, remainingMs / Math.max(1, pause.until - pause.startedAt));
  const who =
    pause.by === view.youId ? "You" : (view.players.find((p) => p.id === pause.by)?.name ?? "Someone");
  const canResume = view.youId !== null && pause.by === view.youId; // only the player who paused

  return (
    <div className="pause-bar" data-testid="pause-bar">
      <p>
        {who} paused the game. It resumes in{" "}
        <span role="timer" aria-label={`${seconds} seconds until the game resumes`}>
          {seconds}
        </span>
        s.
      </p>
      <div
        className="pause-bar-track"
        role="progressbar"
        aria-label="Pause time left"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div
          className="pause-bar-fill"
          data-testid="pause-bar-fill"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      {canResume && (
        <Button onClick={onResume} pending={pending}>
          Resume
        </Button>
      )}
    </div>
  );
}
