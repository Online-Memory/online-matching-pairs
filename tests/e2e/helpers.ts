import type { Page } from "@playwright/test";

import { expect, type Player } from "./fixtures";

export type TableOptions = { pairs?: number; turnSeconds?: number; theme?: string };

/** Creates a table through the UI for the standard options, or the API for test-only ones. */
export async function createTable(host: Player, options: TableOptions = {}): Promise<string> {
  const { pairs = 8, turnSeconds = 20, theme = "001" } = options;
  const { page } = host;
  if (turnSeconds < 10) {
    const response = await page.request.post("/api/tables", {
      data: { theme, pairs, turnSeconds, name: host.name },
    });
    expect(response.status()).toBe(201);
    const { code } = (await response.json()) as { code: string };
    await page.goto(`/table/${code}`);
  } else {
    await page.goto("/");
    await page.getByLabel("Your name").fill(host.name);
    await page.getByLabel("Tiles").selectOption(String(pairs * 2));
    await page.getByLabel("Seconds per turn").selectOption(String(turnSeconds));
    await page.getByRole("button", { name: "Create table" }).click();
    await page.waitForURL(/\/table\/[A-Z2-9]{6}$/);
  }
  const code = (await page.getByTestId("table-code").textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  return code;
}

export async function joinTable(player: Player, code: string) {
  await player.page.goto(`/table/${code}`);
  await player.page.getByLabel("Your name").fill(player.name);
  await player.page.getByRole("button", { name: "Join table" }).click();
  await expect(player.page.getByText(`${player.name} (you)`)).toBeVisible();
}

export async function startGame(host: Player, others: Player[]) {
  for (const p of others) await expect(host.page.getByText(p.name, { exact: false }).first()).toBeVisible();
  await host.page.getByRole("button", { name: /^Start/ }).click();
  for (const p of [host, ...others]) await expect(p.page.locator(".tile").first()).toBeVisible();
}

export const tile = (page: Page, id: number) => page.locator(`.tile[data-tile-id="${id}"]`);

export async function isMyTurn(page: Page) {
  return (await page.locator("main").getAttribute("data-my-turn")) === "true";
}

export async function expectNoFacesInHiddenTiles(page: Page) {
  const leaks = await page
    .locator('.tile[data-state="hidden"]')
    .evaluateAll(
      (tiles) => tiles.filter((t) => t.querySelector("img") || t.hasAttribute("data-face")).length,
    );
  expect(leaks).toBe(0);
}

/** Reads every face currently visible on the board into `memory` (what a player could see). */
async function observe(page: Page, memory: Map<number, number>) {
  const seen = await page
    .locator(".tile[data-face]")
    .evaluateAll((tiles) =>
      tiles.map(
        (t) => [Number(t.getAttribute("data-tile-id")), Number(t.getAttribute("data-face"))] as const,
      ),
    );
  for (const [id, face] of seen) memory.set(id, face);
}

/**
 * Plays to the end like a player with perfect memory: complete a pair it has already seen,
 * otherwise turn over tiles it hasn't seen yet. Uses only what each browser shows.
 */
export async function playToEnd(players: Player[], { deadlineMs = 100_000 } = {}) {
  const memory = new Map<number, number>();
  const until = Date.now() + deadlineMs;

  while (Date.now() < until) {
    for (const p of players) await observe(p.page, memory);
    const status = await players[0]!.page.locator("main").getAttribute("data-status");
    if (status === "finished") return;

    const current = await firstAsync(players, (p) => isMyTurn(p.page));
    if (!current) {
      await players[0]!.page.waitForTimeout(200);
      continue;
    }
    const { page } = current;
    await expectNoFacesInHiddenTiles(page);

    const hidden = await page
      .locator('.tile[data-state="hidden"]')
      .evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute("data-tile-id"))));
    const faceUp = await page
      .locator('.tile[data-state="revealed"]')
      .evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute("data-face"))));

    let choice: number | undefined;
    if (faceUp.length === 1) {
      choice = hidden.find((id) => memory.get(id) === faceUp[0]) ?? hidden.find((id) => !memory.has(id));
    } else {
      choice =
        hidden.find((a) => memory.has(a) && hidden.some((b) => b !== a && memory.get(b) === memory.get(a))) ??
        hidden.find((id) => !memory.has(id));
    }
    choice ??= hidden[0]!;

    await tile(page, choice).click();
    await expect(tile(page, choice)).not.toHaveAttribute("data-state", "hidden");
    await observe(page, memory);
  }
  throw new Error("game did not finish in time");
}

async function firstAsync<T>(items: T[], predicate: (item: T) => Promise<boolean>) {
  for (const item of items) if (await predicate(item)) return item;
  return undefined;
}

/** Turns over two tiles known (or found) to differ, so the turn passes after the flip-back. */
export async function flipMismatch(page: Page): Promise<[number, number]> {
  const hidden = await page
    .locator('.tile[data-state="hidden"]')
    .evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute("data-tile-id"))));
  for (let i = 0; i + 1 < hidden.length; i += 2) {
    const [a, b] = [hidden[i]!, hidden[i + 1]!];
    await tile(page, a).click();
    await expect(tile(page, a)).toHaveAttribute("data-state", "revealed");
    await tile(page, b).click();
    await expect(tile(page, b)).not.toHaveAttribute("data-state", "hidden");
    if ((await tile(page, b).getAttribute("data-state")) === "revealed") return [a, b];
    // Lucky match: still our turn, try the next two.
  }
  throw new Error("no mismatch possible");
}
