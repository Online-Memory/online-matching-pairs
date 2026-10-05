"use client";

import { faceImageUrl, type TableView } from "@/lib/protocol";

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
              // eslint-disable-next-line @next/next/no-img-element -- tiny static webp, loaded on reveal only
              <img src={faceImageUrl(view.theme, tile.face)} alt="" draggable={false} />
            )}
          </div>
        );
      })}
    </div>
  );
}
