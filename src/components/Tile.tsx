"use client";

import type { CSSProperties } from "react";

import { faceImageUrl, type TileView } from "@/lib/protocol";

type Props = {
  tile: TileView;
  theme: string;
  /** Seat of the player who matched it, for the ownership colour. */
  ownerSeat: number | null;
  ownerName: string | null;
  canFlip: boolean;
  onFlip: (tileId: number) => void;
  /** Just matched: plays the pair celebration (visual only). */
  celebrate?: boolean;
  /** Which way the hover zoom should lean to stay inside the board: -1, 0 or 1 per axis (layout only). */
  zoomLean?: { x: number; y: number };
};

/**
 * A face-down tile renders no picture at all: the face image is only requested once the server has
 * revealed which picture is there.
 */
export function Tile({ tile, theme, ownerSeat, ownerName, canFlip, onFlip, celebrate, zoomLean }: Props) {
  const label =
    tile.state === "hidden"
      ? `Tile ${tile.id + 1}, face down`
      : tile.state === "revealed"
        ? `Tile ${tile.id + 1}, picture ${tile.face}`
        : `Tile ${tile.id + 1}, picture ${tile.face}, matched by ${ownerName ?? "a player"}`;

  return (
    <button
      type="button"
      className="tile"
      data-state={tile.state}
      data-tile-id={tile.id}
      data-face={tile.state === "hidden" ? undefined : tile.face}
      data-seat={ownerSeat ?? undefined}
      data-celebrate={celebrate || undefined}
      style={zoomLean ? ({ "--zoom-x": zoomLean.x, "--zoom-y": zoomLean.y } as CSSProperties) : undefined}
      aria-label={label}
      aria-disabled={!canFlip || tile.state !== "hidden"}
      onClick={() => canFlip && tile.state === "hidden" && onFlip(tile.id)}
    >
      <span className="tile-inner">
        <span className="tile-back" />
        {tile.state !== "hidden" && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny static webp, loaded on reveal only
          <img className="tile-face" src={faceImageUrl(theme, tile.face)} alt="" draggable={false} />
        )}
      </span>
    </button>
  );
}
