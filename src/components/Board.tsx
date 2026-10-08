"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { fitGrid, type GridFit } from "@/lib/client/fit-grid";
import { boardColumns, themeSpriteUrl, type PlayerView, type TileView } from "@/lib/protocol";

import { Tile } from "./Tile";

export type IdealSize = {
  /** Width of the grid with tiles as big as the height allows. */
  width: number;
  /** Width of the grid with tiles at the comfortable size (or the height limit, if that is smaller). */
  comfortable: number;
  /** Height (px) of the area below the grid, when the width rather than the height limits the tiles. */
  slack: number;
};

type Props = {
  tiles: TileView[];
  theme: string;
  players: PlayerView[];
  canFlip: boolean;
  /** Tiles of a pair that was just matched (they get a short celebration). */
  celebrating?: number[];
  onFlip: (tileId: number) => void;
  /** Short message laid over the board, e.g. that it is your turn. */
  cue?: ReactNode;
  /** The game is paused: the board stays visible but faded and inert, with a notice over it. */
  paused?: boolean;
  /** Countdown shown under the "Game Paused" text. */
  pauseBar?: ReactNode;
  /** What the grid would measure if the height of its area were its only limit (px), so the layout can give it exactly that. */
  onIdealSize?: (ideal: IdealSize) => void;
};

/** Gap between tiles in the fit-to-view layout; the stylesheet uses the same value. */
const FIT_GAP = 6;

/** Tile size (px) the side panel yields to: it only widens once the tiles are this big. */
const COMFORTABLE_TILE = 120;

/** Tiles never grow past this (px), however much room there is. */
const MAX_TILE = 200;

export function Board({
  tiles,
  theme,
  players,
  canFlip,
  celebrating,
  onFlip,
  cue,
  paused,
  pauseBar,
  onIdealSize,
}: Props) {
  const columns = boardColumns(tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<GridFit | null>(null);
  const count = tiles.length;
  const onIdealSizeRef = useRef(onIdealSize);
  useEffect(() => {
    onIdealSizeRef.current = onIdealSize;
  });
  // Public information (matched tiles are visible to everyone): two left means the next match ends it.
  const lastPair = count > 2 && tiles.filter((t) => t.state !== "matched").length === 2;

  // The faces all come from one sprite sheet: fetch it up front so the first flip is instant.
  useEffect(() => {
    new Image().src = themeSpriteUrl(theme);
  }, [theme]);

  // On wide screens the stylesheet sizes the area to the viewport and the grid fills it exactly,
  // so the whole board is always visible. Narrow screens ignore --fit-* and scroll instead.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => {
      const next = fitGrid(count, columns, area.clientWidth, area.clientHeight, FIT_GAP, MAX_TILE);
      const tileByHeight = Math.min(MAX_TILE, (area.clientHeight - (rows - 1) * FIT_GAP) / rows);
      if (tileByHeight > 0) {
        const width = Math.ceil(columns * tileByHeight + (columns - 1) * FIT_GAP);
        const comfy = Math.min(tileByHeight, COMFORTABLE_TILE);
        onIdealSizeRef.current?.({
          width,
          comfortable: Math.ceil(columns * comfy + (columns - 1) * FIT_GAP),
          slack: Math.max(0, area.clientHeight - (next.rows * next.size + (next.rows - 1) * FIT_GAP)),
        });
      }
      setFit((prev) =>
        prev && prev.cols === next.cols && prev.size === next.size && prev.rows === next.rows ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [count, columns, rows]);

  // Edge tiles lean inward when zoomed so the enlarged picture is not cut off by the board's edge.
  const layoutCols = fit?.cols ?? columns;
  const layoutRows = Math.ceil(count / layoutCols);
  const lean = (index: number) => {
    const col = index % layoutCols;
    const row = Math.floor(index / layoutCols);
    return {
      x: layoutCols === 1 ? 0 : col === 0 ? 1 : col === layoutCols - 1 ? -1 : 0,
      y: layoutRows === 1 ? 0 : row === 0 ? 1 : row === layoutRows - 1 ? -1 : 0,
    };
  };

  const style = {
    "--cols": columns,
    "--rows": rows,
    "--back": `url(/themes/${theme}/back.webp)`,
    ...(fit && fit.size > 0
      ? { "--fit-cols": fit.cols, "--fit-size": `${fit.size}px`, "--fit-gap": `${FIT_GAP}px` }
      : {}),
  } as CSSProperties;

  return (
    <div className="board-area" ref={areaRef} data-last-pair={lastPair || undefined}>
      <div
        className="board"
        style={style}
        data-can-flip={canFlip && !paused}
        data-paused={paused || undefined}
        role="group"
        aria-label="Board"
      >
        {tiles.map((tile) => {
          const owner = tile.state === "matched" ? players.find((p) => p.id === tile.by) : undefined;
          return (
            <Tile
              key={tile.id}
              tile={tile}
              theme={theme}
              ownerColour={owner?.colour ?? null}
              ownerName={owner?.name ?? null}
              canFlip={canFlip && !paused}
              onFlip={onFlip}
              celebrate={celebrating?.includes(tile.id) ?? false}
              zoomLean={lean(tile.id)}
            />
          );
        })}
      </div>
      {paused ? (
        <div className="board-paused" role="status">
          <div className="board-paused-panel">
            <p className="board-paused-title" data-testid="board-paused">
              Game Paused
            </p>
            {pauseBar}
          </div>
        </div>
      ) : (
        cue
      )}
    </div>
  );
}
