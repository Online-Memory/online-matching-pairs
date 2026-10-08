# Colour preferences

## Goal

Players choose their colour instead of inheriting it from their seat number. Signed-in users rank up to 3
preferred colours on their profile page; guests pick from the colours still free when they join.

## Decisions

- Resolution happens **on join**, in join order. The first free preference wins; conflicts go to whoever joined first.
- A signed-in player with no preferences, or whose preferences are all taken, gets the **lowest free colour**.
- The palette is **16 colours** (`PALETTE_SIZE = 16` in `src/lib/protocol`), up from 12. A colour is unique per table.
  `MAX_PLAYERS` stays 12, so a full table always leaves 4 free colours. The colours are 16 of the 24 hues of the
  [Vecteezy "RGB 24 Color Wheel"](https://www.vecteezy.com/vector-art/68587834-rgb-24-color-wheel-scheme-illustration),
  each fitted for contrast and separation (see Palette). The current 12 colours are replaced.
- Before the game starts, anyone in the lobby may switch to a free colour. The colour is fixed once it starts.
- Colour is stored in player state, no longer derived from `seat`. Tables saved without it fall back to `colour = seat`.

## Palette

Start from the wheel: 24 equal segments, sampled at the middle of each. Used as drawn they fail: Pure Green, Bright Green
and Chartreuse are almost identical (gaps 0.8 to 1.5), Gold sits within 2.4 of `--signal` (the reserved "your turn"
yellow), and 12 segments fall below 3:1 contrast on the light page and 5 on the dark page. A plain subset cannot fix
that (only 7 pass contrast, and only 4 of those are distinguishable), so the palette keeps 16 of the hues and fits each
one's lightness and chroma, separately for the light and the dark theme.

Chosen by a max-min search over the kept hue (one colour per hue). The score of a pair is its **worst-case gap**: OKLab
distance (x100) under normal vision and under protan, deutan and tritan simulation (Machado 2009, colour-blind distances
scaled up by 1/0.62). Constraints on every colour: at least 3:1 contrast against both page backgrounds of its theme (it is
a border or a dot, not text), and at least 12 OKLab units from `--signal`. Names describe how the colour looks, because
the wheel names no longer fit (its "Orange" ends up maroon, its "Yellow" olive).

| index | name      | wheel hue       | light     | dark      |
| ----- | --------- | --------------- | --------- | --------- |
| 0     | Olive     | Yellow          | `#96902b` | `#faf7aa` |
| 1     | Brown     | Orange-Yellow   | `#7d4014` | `#c68862` |
| 2     | Maroon    | Orange          | `#76080d` | `#c15e55` |
| 3     | Coral     | Vermilion       | `#c6585d` | `#fea0a0` |
| 4     | Wine      | Pure Red        | `#6a3446` | `#b2798a` |
| 5     | Raspberry | Crimson         | `#ae1173` | `#fd73bb` |
| 6     | Mauve     | Bright Magenta  | `#9a688b` | `#e5b2d5` |
| 7     | Purple    | Magenta         | `#5e0e70` | `#a560b7` |
| 8     | Lavender  | Electric Violet | `#755eac` | `#bda9f6` |
| 9     | Indigo    | Violet          | `#2f05ac` | `#666bf5` |
| 10    | Navy      | Indigo Golden   | `#263f92` | `#6988da` |
| 11    | Blue      | Pure Blue       | `#3864f3` | `#7ba0fe` |
| 12    | Sky       | Cyan            | `#1c99c6` | `#85d7fd` |
| 13    | Sea green | Aquamarine      | `#50967f` | `#a0e1ca` |
| 14    | Green     | Chartreuse      | `#46880a` | `#93d36e` |
| 15    | Moss      | Yellow-Lime     | `#5f6a1e` | `#a6b36f` |

Measured on these values: closest pair **7.55** (light) and **7.73** (dark), lowest contrast 3.02:1, closest to
`--signal` 23 (light) and 12.5 (dark). For comparison, today's 12 colours score 3.6 (light) and 2.4 (dark).

The CSS (`--seat-0..15` per theme) is generated from this table. `seat-colours.test.ts` recomputes the closest-pair gap and
the contrast from `globals.css` and fails below 7 and 3:1, so a later edit can't bring close pairs back.

Colour alone is still a weak signal for the closest pairs (Cyan / Sea green, Indigo / Navy), so the pickers show each
colour's name next to its swatch. Whether tiles and the scoreboard also need a non-colour cue (initial or name) is left for
the plan to check against the current components.

## Data

One additive migration (`new-migration` skill): `profiles.colour_prefs smallint[] NOT NULL DEFAULT '{}'`, with
checks for at most 3 entries, and values in 0–15. Distinctness is enforced by the API schema, because Postgres does not allow a subquery in a `CHECK`. The old deployment never reads it.

## Engine (`src/server/engine/`)

- `playerSchema.colour: z.number().int().optional()`; effective colour is `colour ?? seat`.
- Pure `pickColour(taken, prefs)`: first free pref, else lowest free colour. No I/O, no randomness.
- The join action takes optional `colourPrefs` (signed-in) or `colour` (guest; rejected with an `EngineError` if taken).
- New lobby-only `choose-colour` action; errors if the colour is taken or the game has started.
- `toView` exposes `colour` per player. It is public, so the anti-cheat invariants are unaffected.

## Server

- The `join` and `create` routes read the user's `colour_prefs` through `FriendsService` and pass them in the action (`TableService` has no access to profiles, and the engine does no I/O). A failed lookup falls back to the lowest free colour.
- `PUT /api/me/colours`: validates and saves the prefs.
- `POST /api/tables/[code]/colour`: lobby colour switch, a thin wrapper over `TableService`.

## Client

- Profile page: "Preferred colours" with 3 ranked slots over the palette swatches; slots can be cleared.
- Guest join flow: swatch picker with taken colours disabled. Lobby: the same picker to switch.
- Tile, Scoreboard, Lobby and Results use `data-seat={colour}`; the CSS stays indexed by colour, and `seat-colours.test.ts` is changed to iterate `PALETTE_SIZE` (it currently uses
  `MAX_PLAYERS`) The swatch pickers show 16 swatches, so they use a wrapping grid.

## Testing (test-first)

- `seat-colours.test.ts`: iterates `PALETTE_SIZE`; every index has a `--seat-N` variable in both themes and a `[data-seat="N"]` rule; the closest-pair gap is at least 7 and the contrast at least 3:1.
- `pickColour`: priority order, conflicts, fallbacks, full table.
- Engine: join and `choose-colour`, including the legacy fallback.
- `TableService` integration test (PGlite) for the prefs lookup.
- Component tests for the picker and the profile section.
- Run `anti-cheat-reviewer` afterwards (engine, protocol and table routes are touched).
