export type GridFit = { cols: number; rows: number; size: number };

/**
 * Size of the square tiles that let a `cols`-wide grid of `count` tiles fill a `width` x `height`
 * box exactly. The grid keeps its shape (e.g. 100 tiles stay 10x10); only the tiles grow or shrink.
 */
export function fitGrid(
  count: number,
  cols: number,
  width: number,
  height: number,
  gap: number,
  maxSize = Infinity,
): GridFit {
  if (count <= 0 || cols <= 0 || width <= 0 || height <= 0) return { cols: 0, rows: 0, size: 0 };

  const rows = Math.ceil(count / cols);
  const size = Math.floor(
    Math.min(maxSize, (width - (cols - 1) * gap) / cols, (height - (rows - 1) * gap) / rows),
  );
  return { cols, rows, size: Math.max(size, 0) };
}
