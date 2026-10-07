"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Tracks which async actions are in flight, by key, so each button can show its own spinner. A ref backs the
 * state so a second call in the same tick (before React has disabled the button) is dropped, not sent twice.
 */
export function usePending() {
  const inFlight = useRef(new Set<string>());
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());

  /** Runs `action` unless one with this key is already running; resolves to `undefined` when it was skipped. */
  const run = useCallback(async <T>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current.has(key)) return undefined;
    inFlight.current.add(key);
    setKeys(new Set(inFlight.current));
    try {
      return await action();
    } finally {
      inFlight.current.delete(key);
      setKeys(new Set(inFlight.current));
    }
  }, []);

  return { run, isPending: (key: string) => keys.has(key) };
}
