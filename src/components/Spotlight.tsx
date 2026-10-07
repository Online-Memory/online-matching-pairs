"use client";

import { faceSprite, type TableView } from "@/lib/protocol";

/**
 * Big view of the tiles that are face up right now, for boards whose grid tiles are small.
 * It only reads tiles the server has already revealed to everyone.
 */
export function Spotlight({ view }: { view: TableView }) {
  const revealed = view.tiles.filter((t) => t.state === "revealed");

  return (
    <div className="spotlight" aria-hidden data-testid="spotlight">
      {[0, 1].map((slot) => {
        const tile = revealed[slot];
        return (
          <div key={slot} className="spotlight-slot" data-filled={tile !== undefined}>
            {tile && tile.state === "revealed" && (
              <span className="spotlight-face" style={faceSprite(view.theme, tile.face)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
