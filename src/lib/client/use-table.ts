"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PollResponse, PublicEvent, SnapshotResponse, TableView } from "@/lib/protocol";

import { api, ApiError } from "./api";

/**
 * How long to wait before the next poll. Turn-based play only needs opponents' moves within about a
 * second; everything slower saves function invocations and database reads.
 */
export function pollDelay(view: TableView | null, hidden: boolean, override?: number): number | null {
  if (view && (view.status === "finished" || view.status === "abandoned")) return null;
  if (override) return override;
  if (hidden) return 5_000;
  if (view?.status === "playing") return 1_000;
  return 2_000;
}

const POLL_OVERRIDE = Number(process.env.NEXT_PUBLIC_POLL_MS) || undefined;
const MAX_BACKOFF_MS = 10_000;

export type TableHandle = {
  view: TableView | null;
  /** Server clock minus local clock, for rendering server deadlines. */
  serverOffset: number;
  /** Most recent public events, newest last, for activity text and effects. */
  events: PublicEvent[];
  loadError: ApiError | null;
  actionError: ApiError | null;
  reconnecting: boolean;
  pending: boolean;
  join: (name?: string) => Promise<void>;
  start: () => Promise<void>;
  flip: (tileId: number) => Promise<void>;
  leave: () => Promise<void>;
  clearActionError: () => void;
};

/**
 * Owns everything about talking to one table: polling with `since`, applying snapshots, replaying
 * events, and sending actions. Components never fetch table state themselves, so polling could be
 * swapped for push (SSE/WebSocket) here without touching the UI or the server engine.
 */
export function useTable(code: string): TableHandle {
  const [view, setView] = useState<TableView | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [pending, setPending] = useState(false);

  const since = useRef(-1);
  const viewRef = useRef<TableView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failures = useRef(0);
  const inFlight = useRef(false);
  const stopped = useRef(false);

  const apply = useCallback((response: PollResponse | SnapshotResponse) => {
    setServerOffset(response.serverNow - Date.now());
    if (response.unchanged) return;
    // A slow poll can land after a newer action response; never move backwards.
    if (response.view.seq < since.current) return;
    since.current = response.view.seq;
    viewRef.current = response.view;
    setView(response.view);
    if (response.events.length) setEvents((prev) => [...prev, ...response.events].slice(-20));
  }, []);

  // The timer calls whatever `poll` is current, so scheduling doesn't depend on it.
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const schedule = useCallback((delay: number | null) => {
    clearTimeout(timer.current);
    if (delay === null || stopped.current) return;
    timer.current = setTimeout(() => void pollRef.current(), delay);
  }, []);

  const poll = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    inFlight.current = true;
    try {
      apply(await api.poll(code, since.current));
      failures.current = 0;
      setReconnecting(false);
      setLoadError(null);
      schedule(pollDelay(viewRef.current, document.hidden, POLL_OVERRIDE));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("internal", String(error), 0);
      if (apiError.code === "not_found") {
        setLoadError(apiError);
        return; // nothing to poll
      }
      failures.current += 1;
      setReconnecting(true);
      if (!viewRef.current) setLoadError(apiError);
      schedule(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** failures.current));
    } finally {
      inFlight.current = false;
    }
  }, [apply, code, schedule]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    stopped.current = false;
    since.current = -1;
    void poll();
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    const onOnline = () => void poll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      stopped.current = true;
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [poll]);

  const run = useCallback(
    async (send: (since: number) => Promise<SnapshotResponse>) => {
      setPending(true);
      setActionError(null);
      try {
        apply(await send(since.current));
        schedule(pollDelay(viewRef.current, document.hidden, POLL_OVERRIDE));
      } catch (error) {
        setActionError(error instanceof ApiError ? error : new ApiError("internal", String(error), 0));
        void poll(); // resync: the rejection usually means our view was stale
      } finally {
        setPending(false);
      }
    },
    [apply, poll, schedule],
  );

  return {
    view,
    serverOffset,
    events,
    loadError,
    actionError,
    reconnecting,
    pending,
    join: (name) => run((s) => api.join(code, s, name)),
    start: () => run((s) => api.start(code, s)),
    flip: (tileId) => run((s) => api.flip(code, s, tileId)),
    leave: () => run((s) => api.leave(code, s)),
    clearActionError: () => setActionError(null),
  };
}
