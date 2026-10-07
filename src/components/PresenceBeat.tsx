"use client";

import { usePresence } from "@/lib/client/use-friends";
import { useSessionRefresh } from "@/lib/client/use-session-refresh";

export function PresenceBeat() {
  usePresence();
  useSessionRefresh();
  return null;
}
