// Slices the original online-memory sprite sheets (8 columns, cell 0 = card back, faces from 1)
// into one sprite per theme (faces only, same 8 columns, cell 0 dropped) plus the card back and picker preview.
// Usage: pnpm themes:slice [path/to/online-memory/packages/client/src/assets/game_templates]
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const COLUMNS = 8;
const SIZE = 192;
const source = process.argv[2] ?? "../online-memory/packages/client/src/assets/game_templates";
const target = "public/themes";
const faceCounts = { "008": 36 };

for (const file of (await readdir(source)).filter((f) => /^\d{3}\.png$/.test(f)).sort()) {
  const theme = file.slice(0, 3);
  const sprite = sharp(path.join(source, file));
  const { width, height } = await sprite.metadata();
  const cell = width / COLUMNS;
  const available = COLUMNS * Math.floor(height / cell + 0.01);
  const faces = Math.min(faceCounts[theme] ?? 50, available - 1);
  const outDir = path.join(target, theme);
  await mkdir(outDir, { recursive: true });

  const extract = (index) =>
    sharp(path.join(source, file))
      .extract({
        left: Math.round((index % COLUMNS) * cell),
        top: Math.round(Math.floor(index / COLUMNS) * cell),
        width: Math.floor(cell),
        height: Math.floor(cell),
      })
      .resize(SIZE, SIZE, { fit: "cover" })
      .webp({ quality: 78 });

  // Sprite: face n sits at cell n - 1, row by row, matching faceSprite() in src/lib/protocol/themes.ts.
  const rows = Math.ceil(faces / COLUMNS);
  const cells = await Promise.all(
    Array.from({ length: faces }, async (_, i) => ({
      input: await extract(i + 1).toBuffer(),
      left: (i % COLUMNS) * SIZE,
      top: Math.floor(i / COLUMNS) * SIZE,
    })),
  );
  await sharp({
    create: { width: COLUMNS * SIZE, height: rows * SIZE, channels: 4, background: "#ffffff00" },
  })
    .composite(cells)
    .webp({ quality: 78 })
    .toFile(path.join(outDir, "sprite.webp"));
  await extract(0).toFile(path.join(outDir, "back.webp"));

  // Theme picker preview: a 2x2 of the first faces.
  const tiles = await Promise.all(
    [1, 2, 3, 4].map((f) =>
      extract(f)
        .resize(SIZE / 2)
        .toBuffer(),
    ),
  );
  await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: "#ffffff" } })
    .composite(
      tiles.map((input, i) => ({ input, left: (i % 2) * (SIZE / 2), top: Math.floor(i / 2) * (SIZE / 2) })),
    )
    .webp({ quality: 78 })
    .toFile(path.join(outDir, "preview.webp"));

  console.log(`${theme}: ${faces} faces (${cell}px cells)`);
}
