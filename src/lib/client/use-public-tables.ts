"use client";

import { useSyncExternalStore } from "react";

import type { PublicTableEntry } from "@/lib/protocol";

import { api } from "./api";

const POLL_MS = 5_000;

type State = { tables: PublicTableEntry[] | null; error: string | null };
const EMPTY: State = { tables: null, error: null };

// One poll for the page, however many components read it.
let state: State = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let latestRequest = 0;
const listeners = new Set<() => void>();

function publish(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

/** Only the newest request may update the state, so a slow, older response can't undo a refresh. */
async function refresh() {
  const mine = ++latestRequest;
  try {
    const { tables } = await api.publicTables();
    if (mine === latestRequest) publish({ tables, error: null });
  } catch (e) {
    if (mine === latestRequest) {
      publish({ tables: state.tables, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    latestRequest++; // a response still in flight belongs to nobody now
    state = EMPTY;
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/** The public directory, polled while the page is open. The last good list survives a failed poll. */
export function usePublicTables() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
