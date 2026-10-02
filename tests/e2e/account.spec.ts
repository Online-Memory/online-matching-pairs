import { expect, test, type Player } from "./fixtures";
import { playToEnd } from "./helpers";

// Needs a Neon Auth branch (NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET); guest-only runs skip it.
test.skip(!process.env.NEON_AUTH_BASE_URL, "Neon Auth is not configured for this run");

async function signUp(player: Player, name: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await player.page.goto("/auth/sign-in");
  await player.page.getByRole("button", { name: "New here? Create an account" }).click();
  await player.page.getByLabel("Name").fill(name);
  await player.page.getByLabel("Email").fill(email);
  await player.page.getByLabel("Password").fill("correct-horse-battery");
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page.getByRole("heading", { name })).toBeVisible();
}

test("a signed-up player sees their finished game in their history", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  await signUp(ann, "Ann Account");

  await ann.page.goto("/");
  await expect(ann.page.getByText("Playing as Ann Account")).toBeVisible();
  await ann.page.getByLabel("Players").selectOption("1");
  await ann.page.getByLabel("Tiles").selectOption("16");
  await ann.page.getByRole("button", { name: "Create table" }).click();
  await ann.page.getByRole("button", { name: "Start solo game" }).click();
  await playToEnd([ann]);

  await ann.page.goto("/profile");
  await expect(ann.page.getByTestId("history").locator("li")).toHaveCount(1);
  await expect(ann.page.getByTestId("history")).toContainText("8 pairs");
});

test("signing in raises the table size from 4 to 12", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const players = ann.page.getByLabel("Players");

  await ann.page.goto("/");
  await expect(ann.page.getByText("Sign in to host up to 12 players")).toBeVisible();
  await expect(players.locator("option")).toHaveCount(4);

  await signUp(ann, "Ann Host");
  await ann.page.goto("/");
  await expect(ann.page.getByText("Playing as Ann Host")).toBeVisible();
  await expect(ann.page.getByText("Sign in to host up to 12 players")).toHaveCount(0);
  await expect(players.locator("option")).toHaveCount(12);

  await players.selectOption("12");
  await ann.page.getByRole("button", { name: "Create table" }).click();
  await expect(ann.page.getByText("up to 12 players")).toBeVisible();
  await expect(ann.page.locator(".lobby-empty")).toHaveCount(11);
});
