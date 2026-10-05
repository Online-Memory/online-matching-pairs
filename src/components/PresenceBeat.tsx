"use client";

import { usePresence } from "@/lib/client/use-friends";

export function PresenceBeat() {
  usePresence();
  return null;
}
