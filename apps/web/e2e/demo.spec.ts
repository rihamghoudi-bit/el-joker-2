import { expect, type Page, test } from "@playwright/test";

const DEMO_PIN = process.env.DEMO_OPERATOR_PIN || "0619";

async function enterChat(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /EL JOKER/ })).toBeVisible();
  await page.getByRole("button", { name: "Go for EL JOKER" }).click();
  await expect(page.getByText("Hi, I'm Lem3alem")).toBeVisible();
}

async function sendScenario(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("You · Operator").first()).toBeVisible();
}

const kpi = (page: Page, label: string) => page.locator("div.glass", { has: page.getByText(label, { exact: true }) }).first();

test("landing → chat: the pre-filled request launches the full mission (scenario A)", async ({ page }) => {
  await enterChat(page);
  const box = page.getByRole("textbox", { name: /Message EL JOKER/ });
  await expect(box).toHaveValue(/500 people in Gabès/);
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByText("You · Operator").first()).toBeVisible();
  await expect(page.getByText(/Team, we have a new mission/)).toBeVisible();
  await expect(kpi(page, "Payment")).toContainText("Paid", { timeout: 60_000 });
  await expect(kpi(page, "Guardian")).toContainText("Approved");
  await expect(page.getByText("Live Hedera proofs")).toBeVisible();
  await expect(page.getByText("Payment confirmed")).toBeVisible();
});

test("scenario D: AI recommends an unverified supplier, the mission is blocked, no payment", async ({ page }) => {
  await enterChat(page);
  await sendScenario(page, /^Scenario D:/);
  await expect(kpi(page, "Guardian")).toContainText("Blocked", { timeout: 60_000 });
  await expect(kpi(page, "Verification")).toContainText("Rejected");
  await expect(kpi(page, "Payment")).toContainText("No payment");
});

test("scenario E: payment stays on hold; wrong PIN refused; valid approval pays", async ({ page }) => {
  await enterChat(page);
  await sendScenario(page, /^Scenario E:/);
  await expect(page.getByText("Human approval required")).toBeVisible({ timeout: 60_000 });
  await expect(kpi(page, "Payment")).toContainText("On hold");

  await page.getByLabel(/Reason/).fill("Need confirmed by the field team");
  await page.getByLabel("Operator PIN").fill("1111");
  await page.getByRole("button", { name: "✓ Approve" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid operator PIN" })).toBeVisible();
  await expect(kpi(page, "Payment")).toContainText("On hold");

  await page.getByLabel("Operator PIN").fill(DEMO_PIN);
  await page.getByRole("button", { name: "✓ Approve" }).click();
  await expect(kpi(page, "Payment")).toContainText("Paid", { timeout: 60_000 });
});

test("scenario F: proof verified, then a deleted event is detected against the ledger", async ({ page }) => {
  await enterChat(page);
  await sendScenario(page, /^Scenario F:/);
  await expect(kpi(page, "Payment")).toContainText("Paid", { timeout: 60_000 });
  // wait until every proof is anchored before verifying
  await expect(page.getByText("consensus…")).toHaveCount(0);

  await page.getByRole("button", { name: "Proof & verify" }).click();
  await page.getByRole("button", { name: /Verify against Hedera/ }).click();
  await expect(page.getByText(/^PROOF VERIFIED/).first()).toBeVisible();

  await page.getByRole("button", { name: /Delete last event/ }).click();
  await page.getByRole("button", { name: /Verify against Hedera/ }).click();
  await expect(page.getByText("TAMPERING DETECTED").first()).toBeVisible();
  await expect(page.getByText("Missing — deleted from the local database")).toBeVisible();
});

test("motion toggle turns the animated backdrop off and on", async ({ page }) => {
  await enterChat(page);
  const toggle = page.getByRole("button", { name: /^Motion:/ });
  const before = await page.evaluate(() => document.documentElement.dataset.motion);
  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.dataset.motion);
  expect(after).not.toBe(before);
  await toggle.click();
});
