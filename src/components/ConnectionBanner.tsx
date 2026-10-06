"use client";

import { useOffline } from "@/lib/client/use-connection";

/** Shown app-wide while requests are paused and retried after a rate limit, outage or lost connection. */
export function ConnectionBanner() {
  if (!useOffline()) return null;
  return (
    <div className="connection-banner" role="status">
      Connection lost. Retrying…
    </div>
  );
}
