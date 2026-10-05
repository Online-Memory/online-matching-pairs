"use client";

import { useState, type CSSProperties } from "react";

import { MISMATCH_LOCK_MS } from "@/lib/protocol";

type Props = { lockUntil: number; serverOffset: number; canDismiss: boolean };

/**
 * Drains while a mismatched pair is face up. The server's `lockUntil` decides when the tiles really
 * flip back; this only shows it. Mount it with `key={lockUntil}`: an early dismissal moves
 * `lockUntil`, and the remount restarts the animation from the new remaining time.
 */
export function FlipBackBar({ lockUntil, serverOffset, canDismiss }: Props) {
  const [remainingMs] = useState(() => Math.max(0, lockUntil - (Date.now() + serverOffset)));
  const from = Math.min(1, remainingMs / MISMATCH_LOCK_MS);

  return (
    <div className="flip-back" data-testid="flip-back">
      <div className="flip-back-track" role="presentation">
        <div
          className="flip-back-fill"
          style={{ "--from": from, "--drain-ms": `${remainingMs}ms` } as CSSProperties}
        />
      </div>
      {canDismiss && <p className="flip-back-hint">Click anywhere to flip them back sooner.</p>}
    </div>
  );
}
