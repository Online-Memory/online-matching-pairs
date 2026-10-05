"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { FriendsResponse } from "@/lib/protocol";

import { api } from "./api";
import { useMe } from "./use-me";

const POLL_MS = 5_000;
const BEAT_MS = 30_000;

type FriendsState = { data: FriendsResponse | null; error: string | null };
const EMPTY: FriendsState = { data: null, error: null };

// One poll for the whole page, however many components read it (profile panel, banner, home invites).
let state: FriendsState = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let latestRequest = 0;
const listeners = new Set<() => void>();

function publish(next: FriendsState) {
  state = next;
  listeners.forEach((l) => l());
}

/** Fetches now. Only the newest request may update the state, so a slow, older response can't undo a refresh. */
export async function refreshFriends() {
  const mine = ++latestRequest;
  try {
    const data = await api.friends();
    if (mine === latestRequest) publish({ data, error: null });
  } catch (e) {
    if (mine === latestRequest) {
      publish({ data: state.data, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshFriends();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshFriends();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    latestRequest++; // a response still in flight belongs to nobody now
    state = EMPTY; // the next signed-in visitor must not see this one's friends
  };
}

const subscribeNever = () => () => {};
const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/** Friends data for signed-in accounts. Components share one poll and the last good payload survives errors. */
export function useFriends() {
  const signedIn = Boolean(useMe()?.user);
  const { data, error } = useSyncExternalStore(
    signedIn ? subscribe : subscribeNever,
    getSnapshot,
    getServerSnapshot,
  );
  return { data: signedIn ? data : null, error: signedIn ? error : null, refresh: refreshFriends };
}

/** Tells the server this account is here. Mounted once in the layout so it also runs during a game. */
export function usePresence() {
  const signedIn = Boolean(useMe()?.user);
  useEffect(() => {
    if (!signedIn) return;
    const beat = () => {
      if (document.visibilityState === "visible") api.heartbeat().catch(() => {});
    };
    beat();
    const id = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [signedIn]);
}
