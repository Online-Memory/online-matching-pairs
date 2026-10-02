import { expect, test } from "./fixtures";
import { createTable, flipMismatch, joinTable, playToEnd, startGame, tile } from "./helpers";

test("two guests play a game to the end", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben", { mobile: true });
  const code = await createTable(ann, { pairs: 8 });
  await joinTable(ben, code);
  await startGame(ann, [ben]);

  await playToEnd([ann, ben]);

  for (const p of [ann, ben]) {
    await expect(p.page.getByRole("heading", { level: 2 })).toHaveText(/win/);
    await expect(p.page.locator('.tile[data-state="matched"]')).toHaveCount(16);
  }
  const pairs = await ann.page.locator(".results tbody tr td:nth-child(3)").allTextContents();
  expect(pairs.map(Number).reduce((a, b) => a + b, 0)).toBe(8);
});

test("guests can host at most 4 players", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  await ann.page.goto("/");
  const options = ann.page.getByLabel("Players").locator("option");
  await expect(options).toHaveText(["Just me", "Up to 2", "Up to 3", "Up to 4"]);

  // The dropdown is a convenience; the API is the real gate.
  const response = await ann.page.request.post("/api/tables", {
    data: { theme: "001", pairs: 8, maxPlayers: 5, turnSeconds: 20, name: "Ann" },
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("Sign in to host up to 12");

  await createTable(ann, { maxPlayers: 4 });
  await expect(ann.page.locator(".lobby-empty")).toHaveCount(3);
});

test("solo practice game", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  await createTable(ann, { pairs: 8, maxPlayers: 1 });
  await ann.page.getByRole("button", { name: "Start solo game" }).click();
  await playToEnd([ann]);
  await expect(ann.page.getByRole("heading", { level: 2 })).toHaveText(/All 8 pairs in \d+ moves/);
});

test("only the player whose turn it is can flip", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const code = await createTable(ann);
  await joinTable(ben, code);
  await startGame(ann, [ben]);

  await expect(ann.page.getByTestId("status-line")).toHaveText(/Your turn/);
  await expect(ben.page.getByTestId("status-line")).toHaveText("Ann's turn");
  // force: the tile is aria-disabled, and Playwright would otherwise wait until it becomes clickable.
  await tile(ben.page, 0).click({ force: true });
  await ben.page.waitForTimeout(500);
  await expect(tile(ben.page, 0)).toHaveAttribute("data-state", "hidden");

  // The server enforces it too, not just the UI.
  const response = await ben.page.request.post(`/api/tables/${code}/flip`, { data: { tileId: 0 } });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "not_your_turn" } });
});

test("a missed pair stays visible to the opponent, then flips back and the turn passes", async ({
  newPlayer,
}) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const code = await createTable(ann);
  await joinTable(ben, code);
  await startGame(ann, [ben]);

  const [a, b] = await flipMismatch(ann.page);
  await expect(tile(ben.page, a)).toHaveAttribute("data-state", "revealed");
  await expect(tile(ben.page, b)).toHaveAttribute("data-state", "revealed");
  await expect(ben.page.getByTestId("status-line")).toHaveText(/Flipping back/);

  await expect(tile(ben.page, a)).toHaveAttribute("data-state", "hidden");
  await expect(ben.page.getByTestId("status-line")).toHaveText(/Your turn/);
  await expect(ann.page.getByTestId("status-line")).toHaveText("Ben's turn");
});

test("an unanswered turn times out and passes to the next player", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const code = await createTable(ann, { turnSeconds: 3 });
  await joinTable(ben, code);
  await startGame(ann, [ben]);

  await tile(ann.page, 0).click();
  await expect(tile(ann.page, 0)).toHaveAttribute("data-state", "revealed");
  await expect(ben.page.getByTestId("status-line")).toHaveText(/Your turn/, { timeout: 8_000 });
  await expect(tile(ben.page, 0)).toHaveAttribute("data-state", "hidden");
});

test("a reloaded or briefly offline player picks up where they left off", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const code = await createTable(ann);
  await joinTable(ben, code);
  await startGame(ann, [ben]);

  await tile(ann.page, 0).click();
  await expect(tile(ann.page, 0)).toHaveAttribute("data-state", "revealed");

  await ann.page.reload();
  await expect(ann.page.getByText("Ann (you)")).toBeVisible();
  await expect(tile(ann.page, 0)).toHaveAttribute("data-state", "revealed");
  await expect(ann.page.getByTestId("status-line")).toHaveText(/Your turn/);

  await ben.context.setOffline(true);
  await expect(ben.page.getByText("Reconnecting…")).toBeVisible({ timeout: 8_000 });
  await tile(ann.page, 1).click();
  await ben.context.setOffline(false);
  await expect(ben.page.getByText("Reconnecting…")).toBeHidden({ timeout: 15_000 });
  await expect(tile(ben.page, 1)).not.toHaveAttribute("data-state", "hidden");
});

test("when the host leaves, the next seat becomes host", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const cy = await newPlayer("Cy");
  const code = await createTable(ann, { maxPlayers: 3 });
  await joinTable(ben, code);
  await joinTable(cy, code);

  await expect(ben.page.getByText("Waiting for the host")).toBeVisible();
  await ann.page.getByRole("button", { name: "Leave table" }).click();
  await expect(ben.page.getByRole("button", { name: "Start game" })).toBeVisible();
  await expect(cy.page.getByText("Waiting for the host")).toBeVisible();

  await ben.page.getByRole("button", { name: "Start game" }).click();
  await expect(cy.page.getByTestId("status-line")).toHaveText("Ben's turn");

  // Mid-game: host leaves, Cy takes over hosting and the turn.
  await ben.page.getByRole("button", { name: "Leave game" }).click();
  await expect(cy.page.getByTestId("seat-Cy")).toContainText("Host");
  await expect(cy.page.getByTestId("status-line")).toHaveText(/Your turn/);
  await expect(cy.page.getByTestId("seat-Ben")).toContainText("Left");
});

test("joining an unknown or full table explains what happened", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const ben = await newPlayer("Ben");
  const cy = await newPlayer("Cy");

  await cy.page.goto("/table/ZZZZZZ");
  await expect(cy.page.getByRole("heading", { name: "No table called ZZZZZZ" })).toBeVisible();

  const code = await createTable(ann, { maxPlayers: 2 });
  await joinTable(ben, code);
  await cy.page.goto(`/table/${code}`);
  await expect(cy.page.getByText("This table is full.")).toBeVisible();
  await expect(cy.page.getByRole("button", { name: "Join table" })).toHaveCount(0);
});

test("the board fits a phone screen", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann", { mobile: true });
  await createTable(ann, { pairs: 18, maxPlayers: 1 });
  await ann.page.getByRole("button", { name: "Start solo game" }).click();
  const box = await ann.page.locator(".board").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const tileBox = await tile(ann.page, 0).boundingBox();
  expect(tileBox!.width).toBeGreaterThanOrEqual(40); // comfortably tappable
});
