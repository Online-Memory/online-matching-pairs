import { ApiError } from "./api-error";

/**
 * One gate for every request the app makes. When a request fails for a reason that retrying can fix
 * (no network, 429, 502-504) the gate closes: one read becomes the probe and retries with backoff,
 * every other read waits behind it, and actions fail fast. The first success opens it again.
 */

const MAX_BACKOFF_MS = 10_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

let offline = false;
let probing = false;
let attempts = 0;
let openWaiters: Array<() => void> = [];
let wake: (() => void) | null = null;
let epoch = 0; // bumped by resetConnection so stale retry loops from a previous test stop
const listeners = new Set<() => void>();

export const isOffline = () => offline;

export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "network" || RETRYABLE_STATUSES.has(error.status));
}

function setOffline(next: boolean) {
  if (offline === next) return;
  offline = next;
  if (!next) {
    probing = false;
    attempts = 0;
    const waiting = openWaiters;
    openWaiters = [];
    waiting.forEach((resolve) => resolve());
  }
  listeners.forEach((listener) => listener());
}

const whenOpen = () => new Promise<void>((resolve) => openWaiters.push(resolve));

function backoffMs(error: unknown): number {
  const hinted = error instanceof ApiError ? error.retryAfterMs : undefined;
  if (hinted !== undefined) return Math.min(hinted, MAX_RETRY_AFTER_MS);
  attempts += 1;
  return Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (attempts - 1)) * (0.75 + Math.random() * 0.25);
}

/** Sleeps, but can be cut short by the browser reporting that it is back online. */
function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    wake = done;
  });
}

async function read<T>(attempt: () => Promise<T>): Promise<T> {
  let prober = false;
  const mine = epoch;
  for (;;) {
    if (mine !== epoch) return new Promise<T>(() => {});
    if (!offline) prober = false; // someone else reopened the gate
    if (!prober && offline && probing) {
      await whenOpen();
      continue;
    }
    try {
      const result = await attempt();
      setOffline(false);
      return result;
    } catch (error) {
      if (!isRetryable(error)) {
        setOffline(false); // the server answered, so the connection is fine
        throw error;
      }
      if (!prober) {
        if (offline && probing) continue; // another read took over probing meanwhile
        prober = true;
        probing = true;
        setOffline(true);
      }
      await sleep(backoffMs(error));
    }
  }
}

async function action<T>(attempt: () => Promise<T>): Promise<T> {
  // A move made against a view we can't refresh could be wrong by the time we reconnect, so don't queue it.
  if (offline) throw new ApiError("network", "Reconnecting… try again in a moment.", 0);
  try {
    return await attempt();
  } catch (error) {
    if (isRetryable(error)) setOffline(true);
    throw error;
  }
}

export function guarded<T>(kind: "read" | "action", attempt: () => Promise<T>): Promise<T> {
  return kind === "read" ? read(attempt) : action(attempt);
}

if (typeof window !== "undefined") window.addEventListener("online", () => wake?.());

/** For tests. */
export function resetConnection() {
  epoch += 1;
  wake?.();
  offline = false;
  probing = false;
  attempts = 0;
  openWaiters = [];
  listeners.clear();
}
