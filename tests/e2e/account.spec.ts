import { expect, test } from "./fixtures";
import { playToEnd } from "./helpers";

// Needs a Neon Auth branch (NEON_AUTH_BASE_URL + NEON_AUTH_COOKIE_SECRET); guest-only runs skip it.
test.skip(!process.env.NEON_AUTH_BASE_URL, "Neon Auth is not configured for this run");

test("a signed-up player sees their finished game in their history", async ({ newPlayer }) => {
  const ann = await newPlayer("Ann");
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await ann.page.goto("/auth/sign-in");
  await ann.page.getByRole("button", { name: "New here? Create an account" }).click();
  await ann.page.getByLabel("Name").fill("Ann Account");
  await ann.page.getByLabel("Email").fill(email);
  await ann.page.getByLabel("Password").fill("correct-horse-battery");
  await ann.page.getByRole("button", { name: "Create account" }).click();
  await expect(ann.page.getByRole("heading", { name: "Ann Account" })).toBeVisible();

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
