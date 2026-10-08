"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MIN_REVEAL_MS,
  MISMATCH_LOCK_MS,
  type PollResponse,
  type PublicEvent,
  type SnapshotResponse,
  type TableView,
} from "@/lib/protocol";

import { setActiveTable } from "./active-table";
import { api, ApiError } from "./api";
import { useOffline } from "./use-connection";

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

export type TableAction = "join" | "start" | "flip" | "dismiss" | "pause" | "resume" | "voteKick" | "leave";

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
  /** Which action is awaiting the server, so the button that sent it can show a spinner. */
  pendingAction: TableAction | null;
  join: (name?: string) => Promise<void>;
  start: () => Promise<void>;
  flip: (tileId: number) => Promise<void>;
  /**
   * Turns a missed pair face down on this client at once instead of waiting for the lock to expire,
   * then tells the server once the pair has been visible long enough for everyone else to see it.
   */
  dismiss: () => Promise<void>;
  /** True from a local flip-back until the server confirms it; there is nothing left to dismiss. */
  flippedBack: boolean;
  /** Pauses the game for up to a minute (up to 5 times per player). */
  pause: () => Promise<void>;
  /** Ends a pause early; only the player who paused can. */
  resume: () => Promise<void>;
  /** Votes to kick the player whose turn timed out; they are removed once every other active player agrees. */
  voteKick: () => Promise<void>;
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
  const [failing, setFailing] = useState(false);
  // Network, 429 and 502-504 failures are retried inside `api` behind a shared gate that holds back
  // every other request too; this hook only sees the failures that retrying won't fix.
  const reconnecting = useOffline() || failing;
  const [pendingAction, setPendingAction] = useState<TableAction | null>(null);
  // Tiles we turned face down ahead of the server, and the snapshot we did it on. Any snapshot that
  // is not newer than that one (e.g. a poll already in flight) is masked; a newer one is the server's
  // answer and replaces the mask, so nothing needs clearing.
  type FlippedBack = { ids: number[]; seq: number };
  const [flipped, setFlipped] = useState<FlippedBack | null>(null);
  const flippedRef = useRef<FlippedBack | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serverOffsetRef = useRef(0);
  useEffect(() => {
    serverOffsetRef.current = serverOffset;
  }, [serverOffset]);

  const since = useRef(-1);
  const viewRef = useRef<TableView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failures = useRef(0);
  const inFlight = useRef(false);
  const stopped = useRef(false);

  /** Returns true when the view we hold was built for a different identity and must be refetched. */
  const apply = useCallback((response: PollResponse | SnapshotResponse): boolean => {
    setServerOffset(response.serverNow - Date.now());
    if (response.unchanged) {
      // "Nothing changed" is only true for the identity our view was built for. If the server now sees
      // us differently (e.g. one poll was answered for nobody), drop `since` to get a fresh snapshot.
      const stale = viewRef.current !== null && response.youId !== viewRef.current.youId;
      if (stale) since.current = -1;
      return stale;
    }
    // A slow poll can land after a newer action response; never move backwards.
    if (response.view.seq < since.current) return false;
    since.current = response.view.seq;
    viewRef.current = response.view;
    setView(response.view);
    if (flippedRef.current && response.view.seq > flippedRef.current.seq) flippedRef.current = null;
    if (response.events.length) setEvents((prev) => [...prev, ...response.events].slice(-20));
    return false;
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
      const stale = apply(await api.poll(code, since.current));
      failures.current = 0;
      setFailing(false);
      setLoadError(null);
      schedule(stale ? 0 : pollDelay(viewRef.current, document.hidden, POLL_OVERRIDE));
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("internal", String(error), 0);
      if (apiError.code === "not_found") {
        setLoadError(apiError);
        return; // nothing to poll
      }
      failures.current += 1;
      setFailing(true);
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
      clearTimeout(dismissTimer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [poll]);

  // Tell the presence heartbeat where we sit, so friends aren't offered an invite while we're busy.
  const seatedInGame =
    view !== null &&
    (view.status === "lobby" || view.status === "playing") &&
    view.players.some((p) => p.id === view.youId && p.status !== "left");
  useEffect(() => {
    if (!seatedInGame) return;
    setActiveTable(code);
    return () => setActiveTable(null);
  }, [code, seatedInGame]);

  /** Resolves to whether the server accepted the action. */
  const run = useCallback(
    async (action: TableAction, send: (since: number) => Promise<SnapshotResponse>): Promise<boolean> => {
      setPendingAction(action);
      setActionError(null);
      try {
        apply(await send(since.current));
        schedule(pollDelay(viewRef.current, document.hidden, POLL_OVERRIDE));
        return true;
      } catch (error) {
        setActionError(error instanceof ApiError ? error : new ApiError("internal", String(error), 0));
        void poll(); // resync: the rejection usually means our view was stale
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [apply, poll, schedule],
  );

  const dismiss = useCallback(async () => {
    const current = viewRef.current;
    if (!current || flippedRef.current) return;
    const ids = current.tiles.filter((t) => t.state === "revealed").map((t) => t.id);
    if (!ids.length) return;
    const mask = { ids, seq: current.seq };
    flippedRef.current = mask;
    setFlipped(mask);
    // The server ignores a dismissal made before the pair has been visible for MIN_REVEAL_MS (other
    // players' polls must see it), so hold the request back until then.
    const shownSince = current.lockUntil === null ? 0 : current.lockUntil - MISMATCH_LOCK_MS;
    const wait = Math.max(0, shownSince + MIN_REVEAL_MS - (Date.now() + serverOffsetRef.current));
    await new Promise<void>((resolve) => {
      dismissTimer.current = setTimeout(resolve, wait);
    });
    if (stopped.current || flippedRef.current !== mask) return;
    if (!(await run("dismiss", (s) => api.dismiss(code, s)))) {
      flippedRef.current = null; // the rejection re-polls; show whatever the server says
      setFlipped(null);
    }
  }, [code, run]);

  // What components render: the server's view, minus the tiles we've already turned face down.
  const activeMask = view && flipped && view.seq <= flipped.seq ? flipped : null;
  const shownView = useMemo(() => {
    if (!view || !activeMask) return view;
    return {
      ...view,
      tiles: view.tiles.map((t): TableView["tiles"][number] =>
        t.state === "revealed" && activeMask.ids.includes(t.id) ? { id: t.id, state: "hidden" } : t,
      ),
    };
  }, [view, activeMask]);

  return {
    view: shownView,
    serverOffset,
    events,
    loadError,
    actionError,
    reconnecting,
    pending: pendingAction !== null,
    pendingAction,
    join: async (name) => void (await run("join", (s) => api.join(code, s, name))),
    start: async () => void (await run("start", (s) => api.start(code, s))),
    flip: async (tileId) => void (await run("flip", (s) => api.flip(code, s, tileId))),
    dismiss,
    flippedBack: activeMask !== null,
    pause: async () => void (await run("pause", (s) => api.pause(code, s))),
    resume: async () => void (await run("resume", (s) => api.resume(code, s))),
    voteKick: async () => void (await run("voteKick", (s) => api.voteKick(code, s))),
    leave: async () => void (await run("leave", (s) => api.leave(code, s))),
    clearActionError: () => setActionError(null),
  };
}
