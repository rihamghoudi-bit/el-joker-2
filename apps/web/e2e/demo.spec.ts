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

test("scenario E: payment locked in the vault; wrong PIN refused; valid approval co-signs and pays", async ({ page }) => {
  await enterChat(page);
  await sendScenario(page, /^Scenario E:/);
  await expect(page.getByText("Human approval required")).toBeVisible({ timeout: 60_000 });
  await expect(kpi(page, "Payment")).toContainText("Locked in vault");
  await expect(page.getByText("1 of 2 signatures").first()).toBeVisible();

  await page.getByLabel(/Reason/).fill("Need confirmed by the field team");
  await page.getByLabel("Operator PIN").fill("1111");
  await page.getByRole("button", { name: "✓ Approve" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid operator PIN" })).toBeVisible();
  await expect(kpi(page, "Payment")).toContainText("Locked in vault");

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

test("scenario I: ACME (second organization) — its own policy, vault above its $2,000 limit", async ({ page }) => {
  await enterChat(page);
  await sendScenario(page, /^Scenario I:/);
  await expect(page.getByText(/Team, we have a new mission for ACME Tunisia/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("exceeds the autonomous limit $2,000").first()).toBeVisible({ timeout: 60_000 });
  await expect(kpi(page, "Payment")).toContainText("Locked in vault");
  await page.getByLabel(/Reason/).fill("Budget line ENG-2026 approved");
  await page.getByLabel("Operator PIN").fill(DEMO_PIN);
  await page.getByRole("button", { name: "✓ Approve" }).click();
  await expect(kpi(page, "Payment")).toContainText("Paid", { timeout: 60_000 });
});

test("public verifier: the browser recomputes the proofs and catches a rewritten history", async ({ page, request }) => {
  const { missionId } = await (await request.post("/api/scenarios/F_TAMPERING/run")).json();
  await expect.poll(async () => {
    const s = await (await request.get(`/api/missions/${missionId}`)).json();
    return s.mission.status === "PAID" && !s.busy && !s.auditEvents.some((e: { anchor: { status: string } }) => e.anchor.status === "PENDING");
  }, { timeout: 60_000 }).toBe(true);

  await page.goto(`/verify?mission=${missionId}`);
  await expect(page.getByText(/^VERIFIED/).first()).toBeVisible({ timeout: 30_000 });

  await request.post(`/api/missions/${missionId}/tamper`, { data: { mode: "REWRITE_HASHES" } });
  await page.getByRole("button", { name: "Verify this mission" }).click();
  await expect(page.getByText("TAMPERING DETECTED").first()).toBeVisible({ timeout: 30_000 });
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
