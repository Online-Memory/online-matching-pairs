import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import type { PollResponse, SnapshotResponse } from "../../src/lib/protocol";

/**
 * Every scenario runs through this fixture. It records each table API response and theme image
 * request seen by every simulated player, and after the test fails if:
 *  - a hidden tile in any view carries anything but {id, state},
 *  - a face appears anywhere except a revealed/matched tile or a tile_revealed event,
 *  - a face image was requested before that face had been revealed to that browser,
 *  - the DOM of a face-down tile contains a picture or a face attribute.
 */
type Capture = {
  player: string;
  responses: unknown[];
  problems: string[];
  revealedFaces: Set<number>;
  requestedFaces: Set<number>;
};

export type Player = { name: string; page: Page; context: BrowserContext };

type Fixtures = {
  newPlayer: (name: string, options?: { mobile?: boolean }) => Promise<Player>;
};

export const test = base.extend<Fixtures>({
  newPlayer: async ({ browser }, use) => {
    const captures: Capture[] = [];
    const players: Player[] = [];

    await use(async (name, options) => {
      const { player, capture } = await createPlayer(browser, name, options?.mobile ?? false);
      captures.push(capture);
      players.push(player);
      return player;
    });

    for (const player of players) {
      await scanDom(
        player.page,
        captures.find((c) => c.player === player.name)!,
      );
      await player.context.close();
    }
    const problems = captures.flatMap((c) => c.problems.map((p) => `${c.player}: ${p}`));
    expect(problems, "hidden information reached a browser").toEqual([]);
    expect(captures.reduce((n, c) => n + c.responses.length, 0)).toBeGreaterThan(0);
  },
});

export { expect };

async function createPlayer(browser: Browser, name: string, mobile: boolean) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  const page = await context.newPage();
  const capture: Capture = {
    player: name,
    responses: [],
    problems: [],
    revealedFaces: new Set(),
    requestedFaces: new Set(),
  };

  page.on("response", async (response) => {
    if (!/\/api\/tables(\/|$)/.test(new URL(response.url()).pathname)) return;
    const body = (await response.json().catch(() => null)) as PollResponse | SnapshotResponse | null;
    if (!body || "error" in body || !("unchanged" in body)) return; // e.g. create returns just {code}
    capture.responses.push(body);
    for (const problem of inspect(body, capture.revealedFaces)) capture.problems.push(problem);
  });

  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/^\/themes\/\d{3}\/(\d+)\.webp$/);
    // The home page hero shows a few fixed decorative faces; only table pages are checked.
    if (!match || !page.url().includes("/table/")) return;
    // Checked at the end: the response listener parses bodies asynchronously, so ordering here is racy.
    capture.requestedFaces.add(Number(match[1]));
  });

  return { player: { name, page, context }, capture };
}

function inspect(body: PollResponse | SnapshotResponse, revealedFaces: Set<number>): string[] {
  const problems: string[] = [];
  if (body.unchanged) return problems;
  if (JSON.stringify(body).includes('"board"')) problems.push("response contains a board");

  for (const tile of body.view.tiles) {
    if (tile.state === "hidden") {
      const keys = Object.keys(tile).sort().join(",");
      if (keys !== "id,state") problems.push(`hidden tile ${tile.id} has keys ${keys}`);
    } else {
      revealedFaces.add(tile.face);
    }
  }
  for (const event of body.events) if (event.type === "tile_revealed") revealedFaces.add(event.face);

  walk(body, (node, path) => {
    if (!("face" in node)) return;
    const allowed =
      (path.includes("tiles") && (node.state === "revealed" || node.state === "matched")) ||
      (path.includes("events") && node.type === "tile_revealed");
    if (!allowed) problems.push(`face found at ${path.join(".")}`);
  });
  return problems;
}

function walk(
  value: unknown,
  visit: (node: Record<string, unknown>, path: string[]) => void,
  path: string[] = [],
) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, visit, [...path, String(i)]));
  else if (value && typeof value === "object") {
    visit(value as Record<string, unknown>, path);
    for (const [k, v] of Object.entries(value)) walk(v, visit, [...path, k]);
  }
}

async function scanDom(page: Page, capture: Capture) {
  for (const face of capture.requestedFaces) {
    if (!capture.revealedFaces.has(face))
      capture.problems.push(`requested image for never-revealed face ${face}`);
  }
  if (page.isClosed() || !page.url().includes("/table/")) return;
  const leaks = await page
    .locator('.tile[data-state="hidden"]')
    .evaluateAll((tiles) =>
      tiles
        .filter(
          (t) => t.querySelector("img") || t.hasAttribute("data-face") || /picture/i.test(t.ariaLabel ?? ""),
        )
        .map((t) => t.getAttribute("data-tile-id")),
    );
  for (const id of leaks) capture.problems.push(`face-down tile ${id} exposes its picture in the DOM`);
}
