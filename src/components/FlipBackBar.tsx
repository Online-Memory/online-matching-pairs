"use client";

import { useState, type CSSProperties } from "react";

import { MISMATCH_LOCK_MS } from "@/lib/protocol";

type Props = { lockUntil: number; serverOffset: number };

/**
 * Drains while a mismatched pair is face up. The server's `lockUntil` decides when the tiles really
 * flip back; this only shows it. Mount it with `key={lockUntil}` so the animation restarts if
 * the lock moves (a pause shifts it).
 */
export function FlipBackBar({ lockUntil, serverOffset }: Props) {
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
    </div>
  );
}
