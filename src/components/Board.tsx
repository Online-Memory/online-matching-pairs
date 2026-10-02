"use client";

import type { CSSProperties } from "react";

import { boardColumns, type PlayerView, type TileView } from "@/lib/protocol";

import { Tile } from "./Tile";

type Props = {
  tiles: TileView[];
  theme: string;
  players: PlayerView[];
  canFlip: boolean;
  onFlip: (tileId: number) => void;
};

export function Board({ tiles, theme, players, canFlip, onFlip }: Props) {
  const columns = boardColumns(tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const style = {
    "--cols": columns,
    "--rows": rows,
    "--back": `url(/themes/${theme}/back.webp)`,
  } as CSSProperties;

  return (
    <div className="board" style={style} data-can-flip={canFlip} role="group" aria-label="Board">
      {tiles.map((tile) => {
        const owner = tile.state === "matched" ? players.find((p) => p.id === tile.by) : undefined;
        return (
          <Tile
            key={tile.id}
            tile={tile}
            theme={theme}
            ownerSeat={owner?.seat ?? null}
            ownerName={owner?.name ?? null}
            canFlip={canFlip}
            onFlip={onFlip}
          />
        );
      })}
    </div>
  );
}
