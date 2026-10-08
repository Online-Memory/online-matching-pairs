"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { fitGrid, type GridFit } from "@/lib/client/fit-grid";
import { boardColumns, themeSpriteUrl, type PlayerView, type TileView } from "@/lib/protocol";

import { Tile } from "./Tile";

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
};

/** Gap between tiles in the fit-to-view layout; the stylesheet uses the same value. */
const FIT_GAP = 6;

export function Board({ tiles, theme, players, canFlip, celebrating, onFlip, cue, paused, pauseBar }: Props) {
  const columns = boardColumns(tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<GridFit | null>(null);
  const count = tiles.length;
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
      const next = fitGrid(count, columns, area.clientWidth, area.clientHeight, FIT_GAP);
      setFit((prev) =>
        prev && prev.cols === next.cols && prev.size === next.size && prev.rows === next.rows ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [count, columns]);

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
