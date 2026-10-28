import { useEffect } from "react";

import type { TableView } from "@/lib/protocol";

/**
 * In a solo game, a click anywhere on the page ends the flip-back wait early. Tiles count too (they only
 * dismiss; the tile itself stays put), but other buttons, links and form controls keep their own meaning.
 * The server decides whether that is allowed; this only sends the request.
 */
export function useDismissMiss(view: TableView | null, dismiss: () => void, busy: boolean) {
  const active =
    !!view &&
    view.status === "playing" &&
    !view.pause &&
    view.players.length === 1 &&
    view.turn?.playerId === view.youId &&
    view.lockUntil !== null &&
    !busy;

  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button:not([data-tile-id]), a, input, select, textarea")) return;
      dismiss();
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [active, dismiss]);
}
