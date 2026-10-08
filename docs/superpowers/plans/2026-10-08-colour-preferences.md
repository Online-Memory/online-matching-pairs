# Colour preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players pick their own colour: signed-in users rank up to 3 preferred colours on their profile, guests pick a free colour when they join, and everyone can switch to a free colour in the lobby.

**Architecture:** A colour becomes real player state (`PlayerState.colour`, with `colour ?? seat` as the legacy fallback) instead of being derived from the seat. A pure `pickColour` in the engine resolves preferences on join, in join order. The `join` and `create` routes read the user's stored preferences through `FriendsService` and hand them to the engine, which stays free of I/O. A 16-colour palette lives in `src/lib/protocol/colours.ts` and is mirrored as CSS variables, with a test that keeps them equal and measures separation and contrast.

**Tech Stack:** Next.js (App Router; read `node_modules/next/dist/docs/` before touching route handlers, per CLAUDE.md), TypeScript, Zod, Vitest (+ PGlite integration), node-pg-migrate SQL migrations.

**Spec:** `docs/superpowers/specs/2026-10-08-colour-preferences-design.md`

## Global Constraints

- Palette is **16 colours**, `PALETTE_SIZE = 16`, indexes 0–15; `MAX_PLAYERS` stays 12.
- A colour is unique per table (players with status `left` do not hold one).
- Resolution happens **on join**, in join order: first free preference, else the lowest free colour.
- Colour is changeable in the lobby only; fixed once the game starts.
- Tables saved without `colour` fall back to `colour = seat`.
- At most 3 preferences per profile, each 0–15, no duplicates.
- Closest pair in each theme ≥ 7 (worst case over normal vision and protan/deutan/tritan), contrast ≥ 3:1 against both page backgrounds of its theme, ≥ 12 OKLab×100 from `--signal`.
- Everything under `src/server/` starts with `import "server-only"`; the engine stays pure (no I/O, no `Date.now()`); state leaves the server only through `toView`.
- Migrations are additive and backward compatible; never edit an existing migration; never run `pnpm db:migrate*` (CLAUDE.md).
- **Git is the user's call: no commits, branches or pushes.** Every task ends by leaving its changes uncommitted.
- Do not run Playwright/e2e.

## Review Focus

- A guest picks colour N, someone else takes it before the join lands: the join is rejected with `colour_taken` (409) and the picker refreshes, with no half-seated player.
- A signed-in player joins a table where all three preferences are taken: gets the lowest free colour (no error).
- A table saved before this change (players without `colour`): colours still display as the seat colour, and a new joiner cannot take a colour a legacy player is showing.
- A player leaves the lobby: their colour becomes free for the next joiner and for switching.
- Another player switches colour in the lobby: every other client sees it on the next poll (the change must bump `seq`).
- Preferences with duplicates, more than 3 entries or an out-of-range index are rejected by the API (400) and by the database check.
- The profile read fails (database hiccup) while joining: the join still succeeds with the lowest free colour.

---

## File Structure

| File                                                                                                                              | Responsibility                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/lib/protocol/colours.ts` (new)                                                                                               | `PALETTE` (name + light/dark hex), `PALETTE_SIZE`, `MAX_COLOUR_PREFS`, Zod schemas, `colourName`        |
| `src/lib/protocol/index.ts`                                                                                                       | export colours; `colour_taken` error code; `PlayerView.colour`; request schemas; `colour_changed` event |
| `src/server/engine/colour.ts` (new)                                                                                               | `effectiveColour`, `takenColours`, `pickColour` (pure)                                                  |
| `src/server/engine/{state,engine}.ts`                                                                                             | `PlayerState.colour`, join/create/`choose_colour`, `toView`                                             |
| `db/migrations/1791500000000_colour-prefs.sql` (new)                                                                              | `profiles.colour_prefs`                                                                                 |
| `src/server/friends/service.ts`                                                                                                   | `colourPrefs`, `setColourPrefs`                                                                         |
| `src/app/api/me/colours/route.ts` (new), `src/app/api/tables/[code]/colour/route.ts` (new), join + create routes                  | HTTP surface                                                                                            |
| `src/components/ColourPicker.tsx` (new), `ProfileColours.tsx` (new)                                                               | pickers                                                                                                 |
| `Lobby`, `JoinPanel`, `Profile`, `Scoreboard`, `Results`, `Board`, `Tile`, `TableScreen`, `use-table.ts`, `api.ts`, `globals.css` | wiring                                                                                                  |

Deliberate deviation from the spec text: the spec says `TableService.join` looks up the prefs. `TableService` has no access to profiles and `FriendsService` must not read `table_state`, so the **routes** (which already use `getFriendsService`) fetch the prefs and pass them in the action. Behaviour is identical; the engine still does no I/O.

Also from the spec: the DB `CHECK` constraint cannot test for duplicates (Postgres forbids subqueries in `CHECK`), so the migration enforces count and range, and distinctness is enforced by the Zod schema on the API.

---

### Task 1: Palette and CSS

**Files:**

- Create: `src/lib/protocol/colours.ts`
- Modify: `src/lib/protocol/index.ts` (add `export * from "./colours";` next to `export * from "./themes";`)
- Modify: `src/app/globals.css` (`--seat-*` in `:root` lines ~25-36 and in `:root[data-theme="dark"]` lines ~61-72; `[data-seat]` rules lines ~585-620)
- Test: `src/app/seat-colours.test.ts` (rewrite)

**Interfaces:**

- Produces: `PALETTE: readonly {name: string; light: string; dark: string}[]`, `PALETTE_SIZE: 16`, `MAX_COLOUR_PREFS: 3`, `colourSchema` (int 0–15), `colourPrefsSchema` (≤3, distinct), `colourName(index): string`.

- [ ] **Step 1: Write the failing test.** Replace `src/app/seat-colours.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE, PALETTE_SIZE } from "@/lib/protocol";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

type Rgb = [number, number, number];
const block = (selector: RegExp) => css.match(selector)![1]!;
const THEMES = {
  light: block(/^:root\s*\{([\s\S]*?)^\}/m),
  dark: block(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m),
};
const variable = (text: string, name: string) =>
  text.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!.toLowerCase();
const seatColours = (text: string) =>
  Array.from({ length: PALETTE_SIZE }, (_, i) => variable(text, `seat-${i}`));

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const linear = (hex: string): Rgb => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16))) as Rgb;
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const oklab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const delta = (a: Rgb, b: Rgb) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Machado et al. 2009, severity 1.0, applied in linear RGB.
const CVD: Record<string, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const simulate = (rgb: Rgb, m: number[][]): Rgb =>
  m.map((row) => Math.min(1, Math.max(0, row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]))) as Rgb;
/** Worst case over normal vision and the three colour-blind types (their distances are compressed, so scaled up). */
const gap = (a: Rgb, b: Rgb) =>
  Math.min(
    delta(oklab(a), oklab(b)),
    ...Object.values(CVD).map((m) => delta(oklab(simulate(a, m)), oklab(simulate(b, m))) / 0.62),
  );

describe("seat colours", () => {
  it("PALETTE_SIZE is 16", () => expect(PALETTE_SIZE).toBe(16));

  it.each(Object.entries(THEMES))("%s theme defines every PALETTE colour as --seat-N", (theme, text) => {
    expect(seatColours(text)).toEqual(PALETTE.map((c) => c[theme as "light" | "dark"]));
  });

  // Tiles only get --seat from a [data-seat] rule; without one the ownership border silently vanishes.
  it.each(Array.from({ length: PALETTE_SIZE }, (_, seat) => seat))(
    "colour %i has a [data-seat] rule",
    (seat) => {
      expect(css).toMatch(
        new RegExp(`\\[data-seat="${seat}"\\]\\s*\\{\\s*--seat:\\s*var\\(--seat-${seat}\\)`),
      );
    },
  );

  it.each(Object.entries(THEMES))("%s theme: every pair is at least 7 apart", (_, text) => {
    const colours = seatColours(text).map(linear);
    for (let i = 0; i < colours.length; i++) {
      for (let j = i + 1; j < colours.length; j++) {
        expect(
          gap(colours[i]!, colours[j]!),
          `${PALETTE[i]!.name} vs ${PALETTE[j]!.name}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it.each(Object.entries(THEMES))("%s theme: 3:1 against the page and card, clear of --signal", (_, text) => {
    const backgrounds = [linear(variable(text, "paper")), linear(variable(text, "card"))];
    const signal = oklab(linear(variable(THEMES.light, "signal")));
    seatColours(text).forEach((hex, i) => {
      const rgb = linear(hex);
      for (const bg of backgrounds) {
        expect(contrast(rgb, bg), `${PALETTE[i]!.name} contrast`).toBeGreaterThanOrEqual(3);
      }
      expect(delta(oklab(rgb), signal), `${PALETTE[i]!.name} vs signal`).toBeGreaterThanOrEqual(12);
    });
  });
});
```

- [ ] **Step 2: Create `src/lib/protocol/colours.ts`** (so the test fails on the CSS, not on a missing import):

```ts
import { z } from "zod";

/**
 * Player colours. The index is `PlayerView.colour`. The hex values are mirrored as `--seat-N` in
 * `globals.css`; `src/app/seat-colours.test.ts` keeps them equal and checks separation and contrast.
 * Chosen by a max-min search over the Vecteezy "RGB 24 Color Wheel" hues (see the colour-preferences spec).
 */
export const PALETTE = [
  { name: "Olive", light: "#96902b", dark: "#faf7aa" },
  { name: "Brown", light: "#7d4014", dark: "#c68862" },
  { name: "Maroon", light: "#76080d", dark: "#c15e55" },
  { name: "Coral", light: "#c6585d", dark: "#fea0a0" },
  { name: "Wine", light: "#6a3446", dark: "#b2798a" },
  { name: "Raspberry", light: "#ae1173", dark: "#fd73bb" },
  { name: "Mauve", light: "#9a688b", dark: "#e5b2d5" },
  { name: "Purple", light: "#5e0e70", dark: "#a560b7" },
  { name: "Lavender", light: "#755eac", dark: "#bda9f6" },
  { name: "Indigo", light: "#2f05ac", dark: "#666bf5" },
  { name: "Navy", light: "#263f92", dark: "#6988da" },
  { name: "Blue", light: "#3864f3", dark: "#7ba0fe" },
  { name: "Sky", light: "#1c99c6", dark: "#85d7fd" },
  { name: "Sea green", light: "#50967f", dark: "#a0e1ca" },
  { name: "Green", light: "#46880a", dark: "#93d36e" },
  { name: "Moss", light: "#5f6a1e", dark: "#a6b36f" },
] as const;

export const PALETTE_SIZE = PALETTE.length;
export const MAX_COLOUR_PREFS = 3;

export const colourSchema = z
  .number()
  .int()
  .min(0)
  .max(PALETTE_SIZE - 1);
/** Most wanted first. Each colour at most once. */
export const colourPrefsSchema = z
  .array(colourSchema)
  .max(MAX_COLOUR_PREFS)
  .refine((colours) => new Set(colours).size === colours.length, "Pick each colour only once");

export const colourName = (index: number) => PALETTE[index]?.name ?? "Unknown";
```

Add to `src/lib/protocol/index.ts`, directly under `export * from "./themes";`:

```ts
export * from "./colours";
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `pnpm vitest run src/app/seat-colours.test.ts`
Expected: FAIL: the CSS still defines 12 old colours (`--seat-12` missing, values differ).

- [ ] **Step 4: Update `globals.css`.** In `:root`, replace the block from `--seat-0: #1f4fa3;` through `--seat-11: #8f1f3f;` with:

```css
--seat-0: #96902b;
--seat-1: #7d4014;
--seat-2: #76080d;
--seat-3: #c6585d;
--seat-4: #6a3446;
--seat-5: #ae1173;
--seat-6: #9a688b;
--seat-7: #5e0e70;
--seat-8: #755eac;
--seat-9: #2f05ac;
--seat-10: #263f92;
--seat-11: #3864f3;
--seat-12: #1c99c6;
--seat-13: #50967f;
--seat-14: #46880a;
--seat-15: #5f6a1e;
```

In `:root[data-theme="dark"]`, replace `--seat-0: #5b8ce0;` through `--seat-11: #c4566f;` with:

```css
--seat-0: #faf7aa;
--seat-1: #c68862;
--seat-2: #c15e55;
--seat-3: #fea0a0;
--seat-4: #b2798a;
--seat-5: #fd73bb;
--seat-6: #e5b2d5;
--seat-7: #a560b7;
--seat-8: #bda9f6;
--seat-9: #666bf5;
--seat-10: #6988da;
--seat-11: #7ba0fe;
--seat-12: #85d7fd;
--seat-13: #a0e1ca;
--seat-14: #93d36e;
--seat-15: #a6b36f;
```

After the existing `[data-seat="11"] { --seat: var(--seat-11); }` rule add:

```css
[data-seat="12"] {
  --seat: var(--seat-12);
}
[data-seat="13"] {
  --seat: var(--seat-13);
}
[data-seat="14"] {
  --seat: var(--seat-14);
}
[data-seat="15"] {
  --seat: var(--seat-15);
}
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `pnpm vitest run src/app/seat-colours.test.ts`
Expected: PASS (all tests). If a pair/contrast case fails, a hex was mistyped: compare with the `PALETTE` table, do not loosen the test.

- [ ] **Step 6: Leave uncommitted.** No commit (CLAUDE.md: git is the user's call).

---

### Task 2: Engine, protocol and view

**Files:**

- Modify: `src/lib/protocol/index.ts` (`ERROR_CODES`, `PlayerView`, `PublicEvent`, `joinRequestSchema`, new `chooseColourRequestSchema`)
- Modify: `src/server/http.ts` (`STATUS`)
- Modify: `src/server/engine/state.ts` (`playerSchema`)
- Create: `src/server/engine/colour.ts`, `src/server/engine/colour.test.ts`
- Modify: `src/server/engine/engine.ts` (`Action`, `createTable`, `newPlayer`, `join`, new `chooseColour`, `applyAction`, `toView`)
- Modify: `src/server/engine/index.ts` (`export * from "./colour";`)
- Test: `src/server/engine/engine.test.ts` (append a `describe("colours")`)
- Modify (fixtures): every test file that builds a `PlayerView` literal with `seat:` (see Step 9)

**Interfaces:**

- Consumes: `PALETTE_SIZE`, `colourSchema` (Task 1).
- Produces:
  - `effectiveColour(p: Pick<PlayerState, "colour" | "seat">): number`
  - `takenColours(s: GameState): Set<number>`
  - `pickColour(taken: ReadonlySet<number>, prefs?: readonly number[]): number`
  - `Action` gains `{ type: "join"; identity: Identity; colour?: number; colourPrefs?: readonly number[] }` and `{ type: "choose_colour"; colour: number }`
  - `createTable(code, settings, host, now, hostColourPrefs?: readonly number[])`
  - `PlayerView.colour: number`; `PublicEvent` `{ type: "colour_changed"; playerId: string; colour: number }`; error code `"colour_taken"` (409)
  - `joinRequestSchema = { name?, colour? }`, `chooseColourRequestSchema = { colour }`

- [ ] **Step 1: Write the failing `pickColour` tests.** Create `src/server/engine/colour.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { PALETTE_SIZE } from "@/lib/protocol";

import { effectiveColour, pickColour } from "./colour";

describe("pickColour", () => {
  it("takes the first free preference", () => {
    expect(pickColour(new Set(), [5, 2, 9])).toBe(5);
  });
  it("skips taken preferences in order", () => {
    expect(pickColour(new Set([5]), [5, 2, 9])).toBe(2);
    expect(pickColour(new Set([5, 2]), [5, 2, 9])).toBe(9);
  });
  it("falls back to the lowest free colour when every preference is taken", () => {
    expect(pickColour(new Set([5, 2, 9, 0, 1]), [5, 2, 9])).toBe(3);
  });
  it("uses the lowest free colour with no preferences", () => {
    expect(pickColour(new Set(), [])).toBe(0);
    expect(pickColour(new Set([0, 1]))).toBe(2);
  });
  it("ignores preferences outside the palette", () => {
    expect(pickColour(new Set(), [-1, 99, 2.5, 4])).toBe(4);
  });
  it("throws when the palette is exhausted", () => {
    const all = new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => i));
    expect(() => pickColour(all, [])).toThrow();
  });
});

describe("effectiveColour", () => {
  it("is the stored colour, else the seat (tables saved before colours existed)", () => {
    expect(effectiveColour({ colour: 7, seat: 1 })).toBe(7);
    expect(effectiveColour({ colour: undefined, seat: 3 })).toBe(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`./colour` missing)

Run: `pnpm vitest run src/server/engine/colour.test.ts`
Expected: FAIL: "Failed to resolve import ./colour".

- [ ] **Step 3: Implement `src/server/engine/colour.ts`:**

```ts
import "server-only";

import { PALETTE_SIZE } from "@/lib/protocol";

import type { GameState, PlayerState } from "./state";

/** Tables saved before colours existed have none on the player; their colour was the seat index. */
export const effectiveColour = (p: Pick<PlayerState, "colour" | "seat">): number => p.colour ?? p.seat;

/** Colours held by players who are still at the table. */
export function takenColours(s: GameState): Set<number> {
  return new Set(s.players.filter((p) => p.status !== "left").map(effectiveColour));
}

const inPalette = (c: number) => Number.isInteger(c) && c >= 0 && c < PALETTE_SIZE;

/** The first free preference, else the lowest free colour. Pure: no randomness, no I/O. */
export function pickColour(taken: ReadonlySet<number>, prefs: readonly number[] = []): number {
  for (const c of prefs) if (inPalette(c) && !taken.has(c)) return c;
  for (let c = 0; c < PALETTE_SIZE; c++) if (!taken.has(c)) return c;
  // Unreachable while MAX_PLAYERS < PALETTE_SIZE; fail loudly if someone raises one without the other.
  throw new Error("No free colour left");
}
```

Add to `src/server/engine/index.ts` (after `export * from "./engine";`): `export * from "./colour";`

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm vitest run src/server/engine/colour.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Protocol changes** in `src/lib/protocol/index.ts`:
  - Add `"colour_taken",` to `ERROR_CODES` after `"table_full",`.
  - `PlayerView`: add `/** Index into PALETTE: the colour this player's tiles and seat use. */ colour: number;` after `seat: number;`.
  - `PublicEvent`: add `| { type: "colour_changed"; playerId: string; colour: number }` after the `player_joined` line.
  - Replace `joinRequestSchema` with:

```ts
export const joinRequestSchema = z.object({
  name: displayNameSchema.optional(),
  colour: colourSchema.optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const chooseColourRequestSchema = z.object({ colour: colourSchema });
export type ChooseColourRequest = z.infer<typeof chooseColourRequestSchema>;
```

(`colourSchema` comes from `./colours`; import it with `import { colourSchema } from "./colours";` next to the themes import.)

- In `src/server/http.ts` `STATUS`, add `colour_taken: 409,` after `table_full: 409,`.

- [ ] **Step 6: Write the failing engine tests.** First export what the tests need: at the top of `engine.test.ts` extend the existing import from `"."` with `EngineError` and `effectiveColour` if they are not already there. Append at the end of `src/server/engine/engine.test.ts`:

```ts
describe("colours", () => {
  const join = (n: number, extra: Partial<{ colour: number; colourPrefs: number[] }> = {}): Action => ({
    type: "join",
    identity: id(n),
    ...extra,
  });
  const colourOf = (s: GameState, playerId: string) =>
    effectiveColour(s.players.find((p) => p.id === playerId)!);
  const errorCode = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as EngineError).code;
    }
    return undefined;
  };

  it("gives the host the first free colour, or their first preference", () => {
    const base = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: false, tableName: "T" };
    expect(colourOf(createTable("ABC234", base, id(1), T0), "p1")).toBe(0);
    expect(colourOf(createTable("ABC234", base, id(1), T0, [9, 4]), "p1")).toBe(9);
  });

  it("resolves preferences in join order: the later joiner falls to their next choice", () => {
    let s = createTable(
      "ABC234",
      { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: false, tableName: "T" },
      id(1),
      T0,
      [5, 2],
    );
    s = act(s, "p2", join(2, { colourPrefs: [5, 2] }), T0);
    s = act(s, "p3", join(3, { colourPrefs: [5, 2] }), T0);
    s = act(s, "p4", join(4, { colourPrefs: [5, 2] }), T0);
    expect(["p1", "p2", "p3", "p4"].map((p) => colourOf(s, p))).toEqual([5, 2, 0, 1]);
  });

  it("gives a joiner whose preferences are all taken the lowest free colour", () => {
    let s = lobby(2);
    s = act(s, "p3", join(3, { colourPrefs: [0, 1] }), T0);
    expect(colourOf(s, "p3")).toBe(2);
  });

  it("lets a guest take a chosen free colour and rejects a taken one", () => {
    const s = lobby(2);
    expect(colourOf(act(s, "p3", join(3, { colour: 11 }), T0), "p3")).toBe(11);
    expect(errorCode(() => act(s, "p3", join(3, { colour: 0 }), T0))).toBe("colour_taken");
  });

  it("rejects a colour outside the palette", () => {
    expect(errorCode(() => act(lobby(2), "p3", join(3, { colour: 16 }), T0))).toBe("bad_request");
  });

  it("keeps colours unique when twelve players share the same preferences", () => {
    let s = createTable(
      "ABC234",
      { theme: "001", pairs: 8, maxPlayers: 12, turnSeconds: 20, isPublic: false, tableName: "T" },
      id(1),
      T0,
      [3],
    );
    for (let n = 2; n <= 12; n++) s = act(s, `p${n}`, join(n, { colourPrefs: [3] }), T0);
    const colours = s.players.map((p) => effectiveColour(p));
    expect(new Set(colours).size).toBe(12);
  });

  it("frees the colour of a player who leaves the lobby", () => {
    let s = lobby(2);
    const freed = colourOf(s, "p2");
    s = act(s, "p2", { type: "leave" }, T0);
    expect(colourOf(act(s, "p3", join(3, { colour: freed }), T0), "p3")).toBe(freed);
  });

  it("treats a player saved without a colour as holding their seat colour", () => {
    let s = lobby(2);
    for (const p of s.players) delete p.colour;
    expect(s.players.map((p) => effectiveColour(p))).toEqual([0, 1]);
    expect(errorCode(() => act(s, "p3", join(3, { colour: 1 }), T0))).toBe("colour_taken");
    expect(colourOf(act(s, "p3", join(3), T0), "p3")).toBe(2);
  });

  it("choose_colour switches to a free colour and bumps seq so other clients notice", () => {
    const s = lobby(2);
    const { state, events } = applyAction(
      s,
      "p2",
      { type: "choose_colour", colour: 9 },
      T0 + 1,
      seededRng(42),
    );
    expect(colourOf(state, "p2")).toBe(9);
    expect(state.seq).toBeGreaterThan(s.seq);
    expect(events).toEqual([expect.objectContaining({ type: "colour_changed", playerId: "p2", colour: 9 })]);
  });

  it("choose_colour on your own colour is a no-op with no event", () => {
    const s = lobby(2);
    const mine = colourOf(s, "p2");
    const { state, events } = applyAction(
      s,
      "p2",
      { type: "choose_colour", colour: mine },
      T0,
      seededRng(42),
    );
    expect(events).toEqual([]);
    expect(state.seq).toBe(s.seq);
  });

  it("choose_colour rejects a taken colour, a started game and a stranger", () => {
    const s = lobby(2);
    expect(errorCode(() => act(s, "p2", { type: "choose_colour", colour: colourOf(s, "p1") }, T0))).toBe(
      "colour_taken",
    );
    expect(errorCode(() => act(started(2), "p2", { type: "choose_colour", colour: 9 }, T0))).toBe(
      "already_started",
    );
    expect(errorCode(() => act(s, "p9", { type: "choose_colour", colour: 9 }, T0))).toBe("not_a_player");
  });

  it("exposes the colour in the view, and a switch is visible to every viewer", () => {
    const s = act(lobby(2), "p2", { type: "choose_colour", colour: 9 }, T0);
    expect(toView(s, null).players.map((p) => p.colour)).toEqual([0, 9]);
  });
});
```

(`toView`, `seededRng`, `createTable`, `applyAction` are already imported by this test file; add any that are not.)

- [ ] **Step 7: Run, expect FAIL**

Run: `pnpm vitest run src/server/engine/engine.test.ts -t colours`
Expected: FAIL (type errors / unknown action `choose_colour`, `createTable` extra argument).

- [ ] **Step 8: Implement.**

`src/server/engine/state.ts`, in `playerSchema` after `seat`:

```ts
  /** Index into the palette. Absent on tables saved before colours existed: the colour was then the seat (`effectiveColour`). */
  colour: z.number().int().optional(),
```

`src/server/engine/engine.ts`:

1. Imports: add `import { PALETTE_SIZE } from "@/lib/protocol";` (merge with the existing `@/lib/protocol` import if present) and `import { effectiveColour, pickColour, takenColours } from "./colour";`.
2. `Action`: replace the join line and add the new action:

```ts
type JoinAction = { type: "join"; identity: Identity; colour?: number; colourPrefs?: readonly number[] };

export type Action =
  | JoinAction
  | { type: "choose_colour"; colour: number }
  | { type: "start" }
  | …existing members unchanged
```

3. `createTable` gets the host's preferences:

```ts
export function createTable(
  code: string,
  settings: TableSettings,
  host: Identity,
  now: number,
  hostColourPrefs: readonly number[] = [],
): GameState {
  return {
    code,
    ...settings,
    status: "lobby",
    hostId: host.playerId,
    players: [newPlayer(host, 0, pickColour(new Set(), hostColourPrefs), now)],
```

4. `newPlayer(identity, seat, colour, now)`: add the `colour` parameter and `colour,` after `seat,` in the returned object.
5. `applyAction`: change `case "join": join(draft, action.identity, now);` to `join(draft, action, now);` and add

```ts
    case "choose_colour":
      chooseColour(draft, actorId, action.colour, now);
      break;
```

6. `join`: signature `function join(draft: Draft, action: JoinAction, now: number) { const identity = action.identity; …`. Replace the last block (from `const seat = …` to the `player_joined` emit) with:

```ts
const taken = takenColours(s);
if (action.colour !== undefined) {
  assertColour(action.colour);
  if (taken.has(action.colour)) throw new EngineError("colour_taken", "That colour is already taken");
}
const colour = action.colour ?? pickColour(taken, action.colourPrefs);

const seat = Math.max(-1, ...s.players.map((p) => p.seat)) + 1;
s.players.push(newPlayer(identity, seat, colour, now));
s.lobbyExpiresAt = now + RULES.lobbyIdleMs;
draft.emit({ type: "player_joined", playerId: identity.playerId, name: identity.name }, now);
```

7. Add below `join`:

```ts
function assertColour(colour: number) {
  if (!Number.isInteger(colour) || colour < 0 || colour >= PALETTE_SIZE) {
    throw new EngineError("bad_request", "Unknown colour");
  }
}

function chooseColour(draft: Draft, actorId: string, colour: number, now: number) {
  const s = draft.state;
  const player = requirePlayer(s, actorId);
  if (s.status !== "lobby")
    throw new EngineError("already_started", "Colours are fixed once the game starts");
  assertColour(colour);
  if (effectiveColour(player) === colour) return;
  if (takenColours(s).has(colour)) throw new EngineError("colour_taken", "That colour is already taken");
  player.colour = colour;
  // Emitting bumps `seq`, which is what makes every other client's next poll fetch the new colour.
  draft.emit({ type: "colour_changed", playerId: actorId, colour }, now);
}
```

8. `toView`: after `seat: p.seat,` add `colour: effectiveColour(p),`.

- [ ] **Step 9: Run the engine tests, then fix typecheck fallout**

Run: `pnpm vitest run src/server/engine && pnpm typecheck`
Expected: engine tests PASS. Typecheck reports `colour` missing from `PlayerView` literals in tests and possibly a non-exhaustive switch over `PublicEvent`/`Action`. Fix each: add `colour: 0` beside `seat: 0` in the fixtures (files found earlier: `src/components/{TableScreen,Podium,Board,Results,Scoreboard}.test.tsx`, `src/lib/client/{finish-message,awards}.test.ts`; use `colour: 1` next to `seat: 1`), and handle `colour_changed` wherever an exhaustive switch over event types demands it (a no-op is correct: it needs no toast). Re-run until `pnpm typecheck` is clean.

- [ ] **Step 10: Leave uncommitted.**

---

### Task 3: Storage, service and routes

**Files:**

- Create: `db/migrations/1791500000000_colour-prefs.sql` (use the `new-migration` skill)
- Create: `tests/integration/colour-prefs-migration.test.ts`, `tests/integration/colour-prefs.test.ts`
- Modify: `src/lib/protocol/index.ts` (`setColoursSchema`, `ColoursResponse`)
- Modify: `src/server/friends/service.ts` (`colourPrefs`, `setColourPrefs`)
- Modify: `src/server/tables/service.ts` (`create` takes `hostColourPrefs`)
- Create: `src/app/api/me/colours/route.ts`, `src/app/api/tables/[code]/colour/route.ts`
- Modify: `src/app/api/tables/[code]/join/route.ts`, `src/app/api/tables/route.ts`

**Interfaces:**

- Consumes: `colourPrefsSchema`, `chooseColourRequestSchema`, `Action` `choose_colour`, `createTable(..., hostColourPrefs)` (Tasks 1-2).
- Produces:
  - `FriendsService.colourPrefs(userId: string): Promise<number[]>`
  - `FriendsService.setColourPrefs(account: Account, prefs: number[]): Promise<number[]>`
  - `TableService.create(host, settings, hostColourPrefs?: readonly number[])`
  - `GET|PUT /api/me/colours` → `{ colours: number[] }`; `POST /api/tables/[code]/colour` `{ colour }` → `SnapshotResponse`
  - `setColoursSchema = { colours: colourPrefsSchema }`, `ColoursResponse = { colours: number[] }`

- [ ] **Step 1: Write the failing migration test.** Create `tests/integration/colour-prefs-migration.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("colour prefs migration", () => {
  it("adds profiles.colour_prefs, empty by default, limited to three palette indexes", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const index = files.findIndex((f) => f.endsWith("_colour-prefs.sql"));
    expect(index).toBeGreaterThan(0);
    const up = async (file: string) => {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    };

    for (const file of files.slice(0, index)) await up(file);
    await db.exec(
      `INSERT INTO profiles (user_id, handle, display_name, last_seen_at) VALUES ('u1', 'old_user', 'Old', now())`,
    );
    await up(files[index]!);

    const row = (await db.query<{ colour_prefs: number[] }>(`SELECT colour_prefs FROM profiles`)).rows[0]!;
    expect(row.colour_prefs).toEqual([]);

    await db.exec(`UPDATE profiles SET colour_prefs = '{15,0,7}'`);
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{1,2,3,4}'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{16}'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{-1}'`)).rejects.toThrow();
    await db.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm vitest run tests/integration/colour-prefs-migration.test.ts`
Expected: FAIL: `index` is -1 (no migration yet).

- [ ] **Step 3: Create the migration** `db/migrations/1791500000000_colour-prefs.sql` (the timestamp must sort after `1791405007817_achievements.sql`):

```sql
-- Up Migration

-- Up to three palette indexes (0-15), most wanted first, used to pick a colour when a signed-in player takes a seat.
-- Distinctness is enforced by the API: Postgres does not allow a subquery in a CHECK.
ALTER TABLE profiles
  ADD COLUMN colour_prefs smallint[] NOT NULL DEFAULT '{}'
  CONSTRAINT profiles_colour_prefs_valid CHECK (
    cardinality(colour_prefs) <= 3
    AND colour_prefs <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]::smallint[]
  );

-- Down Migration

ALTER TABLE profiles DROP COLUMN colour_prefs;
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm vitest run tests/integration/colour-prefs-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing service tests.** Create `tests/integration/colour-prefs.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { effectiveColour, seededRng } from "@/server/engine";
import { loadTable } from "@/server/db/tables";
import { FriendsService, type Account } from "@/server/friends/service";
import { TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const settings = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: false, tableName: "T" };
const alice: Account = { id: "alice", name: "Alice" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let friends: FriendsService;
let tables: TableService;
let now: number;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  now = 1_700_000_000_000;
  tables = new TableService(db, { clock: () => now, rng: seededRng(3) });
  friends = new FriendsService(db, { clock: () => now, seating: tables });
});

describe("colour preferences", () => {
  it("are empty until set, and round-trip in priority order", async () => {
    expect(await friends.colourPrefs(alice.id)).toEqual([]);
    expect(await friends.setColourPrefs(alice, [9, 2, 14])).toEqual([9, 2, 14]);
    expect(await friends.colourPrefs(alice.id)).toEqual([9, 2, 14]);
    await friends.setColourPrefs(alice, []);
    expect(await friends.colourPrefs(alice.id)).toEqual([]);
  });

  it("a stored preference decides the host's colour at table creation", async () => {
    await friends.setColourPrefs(alice, [9]);
    const { code } = await tables.create(
      { playerId: "u_alice", userId: "alice", name: "Alice" },
      settings,
      await friends.colourPrefs(alice.id),
    );
    const state = (await loadTable(db, code))!.state;
    expect(effectiveColour(state.players[0]!)).toBe(9);
  });

  it("a joiner gets their preference through the service, and a rival falls back", async () => {
    const { code } = await tables.create({ playerId: "g_host", userId: null, name: "Host" }, settings, [4]);
    const guest = { playerId: "g_bob", userId: null, name: "Bob" };
    const snap = await tables.act(code, guest, { type: "join", identity: guest, colourPrefs: [4, 6] }, -1);
    expect(snap.view.players.map((p) => p.colour)).toEqual([4, 6]);
  });
});
```

- [ ] **Step 6: Run, expect FAIL** (`colourPrefs` / `setColourPrefs` undefined, `create` arity)

Run: `pnpm vitest run tests/integration/colour-prefs.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement the service and protocol bits.**

`src/lib/protocol/index.ts`, next to `setHandleSchema`:

```ts
export const setColoursSchema = z.object({ colours: colourPrefsSchema });
export type ColoursResponse = { colours: number[] };
```

(add `colourPrefsSchema` to the `./colours` import.)

`src/server/tables/service.ts`: change `create` to

```ts
  async create(
    host: Identity,
    settings: TableSettings,
    hostColourPrefs: readonly number[] = [],
  ): Promise<{ code: string }> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode(this.rng);
      const state = createTable(code, settings, host, this.clock(), hostColourPrefs);
```

`src/server/friends/service.ts`, add after `setHandle`:

```ts
  /** The colours a player would like, most wanted first. Empty when they never chose any. */
  async colourPrefs(userId: string): Promise<number[]> {
    const rows = await this.db.query<{ colour_prefs: unknown }>(
      `SELECT colour_prefs FROM profiles WHERE user_id = $1`,
      [userId],
    );
    return parsePrefs(rows[0]?.colour_prefs);
  }

  /** `prefs` is already validated (the route runs it through `colourPrefsSchema`). */
  async setColourPrefs(account: Account, prefs: number[]): Promise<number[]> {
    await this.touch(account);
    // Sent as an array literal string: it works the same on every driver, and the values are validated integers.
    await this.db.query(`UPDATE profiles SET colour_prefs = $2::smallint[] WHERE user_id = $1`, [
      account.id,
      `{${prefs.join(",")}}`,
    ]);
    return prefs;
  }
```

and above the class:

```ts
/** Drivers return a smallint[] either as an array or as its text form (`{1,2}`). */
function parsePrefs(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") return value.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
  return [];
}
```

- [ ] **Step 8: Run, expect PASS**

Run: `pnpm vitest run tests/integration/colour-prefs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing route test.** Create `tests/integration/colour-routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET, PUT } from "@/app/api/me/colours/route";

const ctx = { params: Promise.resolve({}) };

describe("colour routes", () => {
  it("answer 401 to guests", async () => {
    expect((await GET(new Request("http://x/api/me/colours"), ctx)).status).toBe(401);
    const put = await PUT(
      new Request("http://x/api/me/colours", { method: "PUT", body: '{"colours":[1]}' }),
      ctx,
    );
    expect(put.status).toBe(401);
  });
});
```

(Validation of bad bodies is covered next, in the signed-in route check.)

- [ ] **Step 10: Run, expect FAIL** (module missing)

Run: `pnpm vitest run tests/integration/colour-routes.test.ts`
Expected: FAIL.

- [ ] **Step 11: Implement the routes.** Read the route-handler guidance in `node_modules/next/dist/docs/` first (CLAUDE.md); the code below follows the existing handlers (`src/app/api/me/handle/route.ts`).

`src/app/api/me/colours/route.ts`:

```ts
import { NextResponse } from "next/server";

import { setColoursSchema, type ColoursResponse } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const GET = route(async () => {
  const account = await requireAccount();
  const colours = await (await getFriendsService()).colourPrefs(account.id);
  return NextResponse.json<ColoursResponse>({ colours });
});

export const PUT = route(async (request) => {
  const account = await requireAccount();
  const { colours } = await readJson(request, setColoursSchema);
  return NextResponse.json<ColoursResponse>({
    colours: await (await getFriendsService()).setColourPrefs(account, colours),
  });
});
```

`src/app/api/tables/[code]/colour/route.ts`:

```ts
import { chooseColourRequestSchema } from "@/lib/protocol";
import { playerAction } from "@/server/actions";
import { readJson } from "@/server/http";

/** Switch to a free colour while the table is still a lobby. */
export const POST = playerAction(async (request) => ({
  type: "choose_colour",
  colour: (await readJson(request, chooseColourRequestSchema)).colour,
}));
```

`src/app/api/tables/[code]/join/route.ts`: replace the body from `const viewer = …` down with:

```ts
const viewer = await getOrCreateViewer();
const identity = {
  playerId: viewer.playerId,
  userId: viewer.userId,
  name: viewer.accountName ?? body.name ?? "",
};
const friends = viewer.userId ? await getFriendsService() : null;
// Best effort: preferences are a nicety, so a profile hiccup falls back to the lowest free colour instead of blocking the join.
const colourPrefs = friends && viewer.userId ? await friends.colourPrefs(viewer.userId).catch(() => []) : [];
const service = await getTableService();
const snapshot = await service.act(
  code,
  identity,
  { type: "join", identity, colour: body.colour, colourPrefs },
  sinceParam(request),
  viewOptions(request),
);
if (friends && viewer.userId) {
  // Best effort: a stale invite is a nuisance, not a reason to fail a join that already succeeded.
  await friends.clearInvitesForTable(viewer.userId, code).catch(() => {});
}
return NextResponse.json<SnapshotResponse>(snapshot);
```

`src/app/api/tables/route.ts`: before `service.create`, add

```ts
// Best effort, as when joining: a failed lookup means the host gets the lowest free colour.
const hostColourPrefs = viewer.userId
  ? await (await getFriendsService()).colourPrefs(viewer.userId).catch(() => [])
  : [];
```

pass `hostColourPrefs` as the third argument of `service.create(...)`, and add `import { getFriendsService } from "@/server/friends";`.

- [ ] **Step 12: Run, expect PASS, plus the whole integration suite**

Run: `pnpm vitest run tests/integration`
Expected: PASS. Existing join/create route behaviour is unchanged for callers that send no colour.

- [ ] **Step 13: Leave uncommitted.**

---

### Task 4: Client: pickers, lobby, profile, ownership colour

**Files:**

- Modify: `src/lib/client/api.ts`, `src/lib/client/use-table.ts`
- Create: `src/components/ColourPicker.tsx`, `src/components/ColourPicker.test.tsx`, `src/components/ProfileColours.tsx`, `src/components/ProfileColours.test.tsx`
- Modify: `src/components/{JoinPanel,Lobby,Profile,Scoreboard,Results,Board,Tile,TableScreen}.tsx`, `src/app/globals.css`
- Test: `src/components/{Lobby,Scoreboard,Profile}`-related tests (add cases listed below), `src/lib/client/use-table.test.ts`

**Interfaces:**

- Consumes: `PALETTE`, `colourName`, `MAX_COLOUR_PREFS` (Task 1); `PlayerView.colour`, `/api/tables/[code]/colour`, `/api/me/colours` (Tasks 2-3).
- Produces:
  - `api.join(code, since, name?, colour?)`, `api.chooseColour(code, since, colour)`, `api.colours()`, `api.setColours(colours)`
  - `TableHandle.join(name?: string, colour?: number)`, `TableHandle.chooseColour(colour: number)`; `TableAction` gains `"colour"`
  - `<ColourPicker value taken onPick disabled? label />`
  - `Tile` prop `ownerColour: number | null` (renamed from `ownerSeat`)

- [ ] **Step 1: Failing test for `ColourPicker`.** Create `src/components/ColourPicker.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PALETTE_SIZE } from "@/lib/protocol";

import { ColourPicker } from "./ColourPicker";

afterEach(cleanup);

describe("ColourPicker", () => {
  it("shows every colour by name and marks the chosen one", () => {
    render(<ColourPicker label="Your colour" value={3} taken={new Set()} onPick={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(PALETTE_SIZE);
    expect(screen.getByRole("radio", { name: "Coral" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Olive" })).not.toBeChecked();
  });

  it("disables taken colours and only reports free picks", async () => {
    const onPick = vi.fn();
    render(<ColourPicker label="Your colour" value={0} taken={new Set([1])} onPick={onPick} />);
    expect(screen.getByRole("radio", { name: "Brown" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Brown" }));
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("radio", { name: "Maroon" }));
    expect(onPick).toHaveBeenCalledWith(2);
  });
});
```

(If `@testing-library/user-event` is not a dependency, check how `Profile.test.tsx`/`Button.test.tsx` click: use `fireEvent.click` from `@testing-library/react` instead and keep the assertions.)

- [ ] **Step 2: Run, expect FAIL**, then create `src/components/ColourPicker.tsx`:

```tsx
"use client";

import { PALETTE } from "@/lib/protocol";

type Props = {
  label: string;
  /** The picked colour, or null when none is picked yet. */
  value: number | null;
  /** Colours that cannot be picked (held by someone else, or already used in another slot). */
  taken: ReadonlySet<number>;
  onPick: (colour: number) => void;
  disabled?: boolean;
};

/** Every palette colour as a named swatch. Names matter: colour alone is a weak signal for the closest pairs. */
export function ColourPicker({ label, value, taken, onPick, disabled }: Props) {
  return (
    <div className="colour-picker" role="radiogroup" aria-label={label}>
      {PALETTE.map((colour, index) => (
        <button
          key={colour.name}
          type="button"
          role="radio"
          aria-checked={value === index}
          aria-label={colour.name}
          className="colour-chip"
          data-seat={index}
          disabled={disabled || (taken.has(index) && value !== index)}
          onClick={() => onPick(index)}
        >
          <span className="seat-token" aria-hidden />
          <span className="colour-chip-name">{colour.name}</span>
        </button>
      ))}
    </div>
  );
}
```

Run: `pnpm vitest run src/components/ColourPicker.test.tsx` → PASS. (`toBeChecked` works on `role=radio` with `aria-checked`.) Add to `globals.css`, after the `.seat-token` rule:

```css
.colour-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.375rem;
}
.colour-chip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border: 2px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--card);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.colour-chip[aria-checked="true"] {
  border-color: var(--seat);
  box-shadow: inset 0 0 0 1px var(--seat);
  font-weight: 700;
}
.colour-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 3: API client and `use-table`.** `src/lib/client/api.ts`: add `ColoursResponse` to the type import; replace `join` and add the three new calls:

```ts
  join: (code: string, since: number, name?: string, colour?: number) =>
    post<SnapshotResponse>(table(code, "join", since), { name, colour }),
  chooseColour: (code: string, since: number, colour: number) =>
    post<SnapshotResponse>(table(code, "colour", since), { colour }),
  colours: () => request<ColoursResponse>("/api/me/colours"),
  setColours: (colours: number[]) => send<ColoursResponse>("PUT", "/api/me/colours", { colours }),
```

`src/lib/client/use-table.ts`: `TableAction` adds `| "colour"`; in `TableHandle` change `join: (name?: string) => Promise<void>;` to `join: (name?: string, colour?: number) => Promise<void>;` and add `chooseColour: (colour: number) => Promise<void>;` after it; in the returned object:

```ts
    join: async (name, colour) => void (await run("join", (s) => api.join(code, s, name, colour))),
    chooseColour: async (colour) => void (await run("colour", (s) => api.chooseColour(code, s, colour))),
```

Add a case to `src/lib/client/use-table.test.ts`, following that file's existing helpers for `join` (find the existing join test and copy its setup): spy `api.chooseColour`, call `result.current.chooseColour(9)`, and assert it was called with `(code, <since>, 9)`. Run `pnpm vitest run src/lib/client/use-table.test.ts` → PASS.

- [ ] **Step 4: Failing tests for the lobby, join panel and ownership colour.** Add to the existing tests (copy the fixture style already in each file):
  - `src/components/Scoreboard.test.tsx`: a player with `seat: 0, colour: 7` renders `data-seat="7"` on its `li` (not `0`).
  - `src/components/Results.test.tsx`: same for the results row.
  - `src/components/Board.test.tsx`: a matched tile owned by a player with `colour: 5` has `data-seat="5"`; its button has `title` equal to the owner's name.
  - A new `src/components/Lobby.test.tsx`:
    - a seated player sees a colour picker (`radiogroup` named "Your colour"); picking a free colour calls `onChooseColour(index)`; colours held by others are disabled; their own is checked.
    - a guest who is not seated (`view.youId === null`, `needsName`) sees a picker with the lowest free colour preselected; clicking Join calls `onJoin(name, colour)` with it; if that colour becomes taken in a new `view`, the selection moves to a free one.
    - a signed-in, unseated viewer (`needsName` false) sees no picker, and Join calls `onJoin(undefined, undefined)`.
    - lobby list items use `data-seat={player.colour}`.

  Run `pnpm vitest run src/components` → FAIL.

- [ ] **Step 5: Implement.**
  - `Tile.tsx`: rename the prop `ownerSeat` → `ownerColour` (type comment: "Colour of the player who matched it"), `data-seat={ownerColour ?? undefined}`, and add `title={tile.state === "matched" ? (ownerName ?? undefined) : undefined}` to the button (a non-colour cue on hover/focus).
  - `Board.tsx` line ~100: `ownerSeat={owner?.seat ?? null}` → `ownerColour={owner?.colour ?? null}`.
  - `Scoreboard.tsx`: `data-seat={p.seat}` → `data-seat={p.colour}`. `Results.tsx`: same. Lobby `li`: same.
  - `JoinPanel.tsx`:

```tsx
"use client";

import { useState } from "react";

import { loadGuestName, saveGuestName } from "@/lib/client/guest-name";
import { PALETTE_SIZE } from "@/lib/protocol";

import { Button } from "./Button";
import { ColourPicker } from "./ColourPicker";
import { NameField } from "./NameField";

type Props = {
  needsName: boolean;
  /** Colours already held at this table. Guests pick from the rest; signed-in players use their saved preferences. */
  takenColours: ReadonlySet<number>;
  pending: boolean;
  joining: boolean;
  onJoin: (name?: string, colour?: number) => void;
};

const firstFree = (taken: ReadonlySet<number>) =>
  Array.from({ length: PALETTE_SIZE }, (_, i) => i).find((i) => !taken.has(i)) ?? 0;

export function JoinPanel({ needsName, takenColours, pending, joining, onJoin }: Props) {
  const [name, setName] = useState(loadGuestName);
  const [picked, setPicked] = useState<number | null>(null);
  // Someone may take the pick while the guest is typing: fall back to a free colour instead of failing the join.
  const colour = picked !== null && !takenColours.has(picked) ? picked : firstFree(takenColours);

  return (
    <form
      className="join-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsName) saveGuestName(name);
        if (needsName) onJoin(name.trim(), colour);
        else onJoin();
      }}
    >
      {needsName && <NameField id="join-name" value={name} onChange={setName} />}
      {needsName && (
        <ColourPicker label="Pick your colour" value={colour} taken={takenColours} onPick={setPicked} />
      )}
      <Button type="submit" disabled={pending || (needsName && !name.trim())} pending={joining}>
        Join table
      </Button>
    </form>
  );
}
```

- `Lobby.tsx`: add props `onChooseColour: (colour: number) => void;`, change `onJoin: (name?: string, colour?: number) => void;`; compute `const takenColours = new Set(view.players.map((p) => p.colour));` and `const mine = view.players.find((p) => p.id === view.youId);`; pass `takenColours={takenColours}` to `JoinPanel`; render, when `isPlayer && mine`, before the actions block:

```tsx
{
  isPlayer && mine && (
    <ColourPicker
      label="Your colour"
      value={mine.colour}
      taken={takenColours}
      onPick={onChooseColour}
      disabled={pending}
    />
  );
}
```

    (import `ColourPicker`.)

- `TableScreen.tsx`: `onJoin={(name, colour) => void table.join(name, colour)}` and `onChooseColour={(colour) => void table.chooseColour(colour)}` on `<Lobby>`. The signed-in auto-join (`void join();`) stays as is: it sends no colour, so the server uses the saved preferences.

Run `pnpm vitest run src/components` → PASS.

- [ ] **Step 6: Failing tests, then implement the profile section.** Create `src/components/ProfileColours.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";

import { ProfileColours } from "./ProfileColours";

beforeEach(() => {
  vi.spyOn(api, "colours").mockResolvedValue({ colours: [3] });
  vi.spyOn(api, "setColours").mockImplementation(async (colours) => ({ colours }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileColours", () => {
  it("shows three ranked slots with the saved choices", async () => {
    render(<ProfileColours />);
    expect(await screen.findByRole("button", { name: /1st choice: Coral/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2nd choice: none/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3rd choice: none/i })).toBeInTheDocument();
  });

  it("saves a pick for the selected slot and shows it", async () => {
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    await waitFor(() => expect(api.setColours).toHaveBeenCalledWith([3, 10]));
    expect(await screen.findByRole("button", { name: /2nd choice: Navy/ })).toBeInTheDocument();
  });

  it("does not let one colour fill two slots", async () => {
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    expect(screen.getByRole("radio", { name: "Coral" })).toBeDisabled();
  });

  it("clears a slot and closes the gap", async () => {
    vi.mocked(api.colours).mockResolvedValue({ colours: [3, 10] });
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear 1st choice" }));
    await waitFor(() => expect(api.setColours).toHaveBeenCalledWith([10]));
  });

  it("puts the old choices back and says so when saving fails", async () => {
    vi.mocked(api.setColours).mockRejectedValue(new Error("nope"));
    render(<ProfileColours />);
    fireEvent.click(await screen.findByRole("button", { name: /2nd choice: none/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Navy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t save/i);
    expect(screen.getByRole("button", { name: /2nd choice: none/i })).toBeInTheDocument();
  });
});
```

Run → FAIL. Create `src/components/ProfileColours.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { colourName, MAX_COLOUR_PREFS } from "@/lib/protocol";

import { ColourPicker } from "./ColourPicker";

const ORDINALS = ["1st", "2nd", "3rd"];

/** Up to three preferred colours in priority order. Each change is saved at once and undone if the save fails. */
export function ProfileColours() {
  const [prefs, setPrefs] = useState<number[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.colours().then(
      (r) => setPrefs(r.colours),
      () => setPrefs([]),
    );
  }, []);

  if (!prefs) return null;

  async function save(next: number[]) {
    const before = prefs;
    setPrefs(next);
    setError(false);
    try {
      setPrefs((await api.setColours(next)).colours);
    } catch {
      setPrefs(before);
      setError(true);
    }
  }

  const pick = (colour: number) => {
    if (active === null) return;
    const next = [...prefs!];
    next[active] = colour;
    setActive(null);
    void save(next);
  };
  const clear = (slot: number) => void save(prefs!.filter((_, i) => i !== slot));

  // A colour already used in another slot can't be picked again.
  const usedElsewhere = new Set(prefs.filter((_, i) => i !== active));

  return (
    <section className="profile-colours" aria-labelledby="profile-colours-heading">
      <h2 id="profile-colours-heading">Preferred colours</h2>
      <p className="hint">At a new table you get your highest choice that is still free.</p>
      <ol className="colour-slots">
        {Array.from({ length: MAX_COLOUR_PREFS }, (_, slot) => {
          const colour = prefs[slot];
          return (
            <li key={slot} data-seat={colour}>
              <button
                type="button"
                className="colour-slot"
                aria-pressed={active === slot}
                aria-label={`${ORDINALS[slot]} choice: ${colour === undefined ? "none" : colourName(colour)}`}
                // Slots fill in order, so only the next empty one or a filled one can be edited.
                disabled={slot > prefs.length}
                onClick={() => setActive(active === slot ? null : slot)}
              >
                {colour !== undefined && <span className="seat-token" aria-hidden />}
                {colour === undefined ? `${ORDINALS[slot]} choice` : colourName(colour)}
              </button>
              {colour !== undefined && (
                <button
                  type="button"
                  className="button-quiet"
                  aria-label={`Clear ${ORDINALS[slot]} choice`}
                  onClick={() => clear(slot)}
                >
                  Clear
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {active !== null && (
        <ColourPicker
          label={`Pick your ${ORDINALS[active]} choice`}
          value={prefs[active] ?? null}
          taken={usedElsewhere}
          onPick={pick}
        />
      )}
      {error && <p role="alert">Couldn&apos;t save your colours. Try again.</p>}
    </section>
  );
}
```

Add minimal CSS after the `.colour-chip` rules:

```css
.colour-slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0;
  padding: 0;
  list-style: none;
}
.colour-slot {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border: 2px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--card);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.colour-slot[aria-pressed="true"] {
  border-color: var(--link);
}
```

Run `pnpm vitest run src/components/ProfileColours.test.tsx` → PASS. Then render it in `Profile.tsx` right after `<LevelBar …/>` / achievements and before `<FriendsPanel />`: add `import { ProfileColours } from "./ProfileColours";` and `<ProfileColours />`; extend `Profile.test.tsx`'s `beforeEach` with `vi.spyOn(api, "colours").mockResolvedValue({ colours: [] });` and add a test `shows the preferred colours section for a signed-in user` that expects `screen.findByRole("heading", { name: "Preferred colours" })`.

- [ ] **Step 7: Run all client tests**

Run: `pnpm vitest run src`
Expected: PASS.

- [ ] **Step 8: Leave uncommitted.**

---

### Task 5: Verify and review

**Files:**

- Modify: `README.md` (colour/preferences section: palette, `colour_prefs`, `PUT /api/me/colours`, `POST /api/tables/[code]/colour`, `colour_taken`); `CLAUDE.md` map line for `src/lib/protocol/colours.ts` only if the `sync-docs` skill finds a documented fact changed.

- [ ] **Step 1: Run the `verify` skill** (lint → format:check → typecheck → test) and fix failures. Run `pnpm exec prettier --write` on any new or changed file it flags (including the spec and this plan).

- [ ] **Step 2: Run the `anti-cheat-reviewer` agent** (the diff touches `src/server/engine/`, `src/lib/protocol/`, `src/app/api/tables/`, `Tile.tsx`, `Board.tsx`). Expected: no hidden-tile or `table_state` regressions; `colour` is public data.

- [ ] **Step 3: Look at it in a browser** (user-run or `run` skill, no Playwright): in light and dark, check the lobby picker, the profile slots, tile ownership borders and the matched dot. Look specifically at dark **Olive** (`#faf7aa`, a pale yellow) next to the "your turn" yellow, and at **Cyan-like pairs** (Sky / Sea green, Indigo / Navy). Report anything that reads as the same colour; swapping a hex means editing `PALETTE`, both CSS blocks and re-running `seat-colours.test.ts`.

- [ ] **Step 4: Update the docs** with the `sync-docs` skill, then report what is ready to commit. Do not commit.

---

## Self-review

**Spec coverage.** Profile prefs (Task 3 service + route, Task 4 `ProfileColours`); resolution on join and for the host (Task 2 `pickColour`/`join`/`createTable`, Task 3 routes); guest picks free colours (Task 4 `JoinPanel` + `colour_taken`); lobby switching (Task 2 `choose_colour`, Task 3 route, Task 4 `Lobby`); 16-colour palette with CSS and measurement test (Task 1); migration (Task 3); legacy `colour ?? seat` (Task 2 tests); public view (Task 2 `toView`); non-colour cue (names in pickers and a `title` on matched tiles); anti-cheat review (Task 5). Spec deviations are listed under File Structure.

**Placeholders.** None: every code step shows code. The only "copy the existing setup" instructions (use-table test, Board/Scoreboard/Results fixtures) name the exact existing test to mirror because those fixtures are file-local.

**Type consistency.** `colour` (number) on `PlayerState` (optional) and `PlayerView` (required); `effectiveColour` used in the engine and in tests; `choose_colour` action ↔ `chooseColourRequestSchema` ↔ `api.chooseColour` ↔ `TableHandle.chooseColour`; `colourPrefs` on the join action ↔ `FriendsService.colourPrefs`; `hostColourPrefs` on `create`/`createTable`; `ownerColour` replaces `ownerSeat` in `Tile` and `Board`.
