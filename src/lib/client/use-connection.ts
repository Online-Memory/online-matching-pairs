"use client";

import { useSyncExternalStore } from "react";

import { isOffline, subscribeConnection } from "./connection";

/** True while requests are being held back and retried because the server or network is unreachable. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribeConnection, isOffline, () => false);
}
