/**
 * REAL Hedera TESTNET integration test. Not part of `npm test`.
 * Run with: npm run test:testnet   (requires HEDERA_* in .env; spends a little testnet HBAR, never mainnet)
 */
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap";
import { buildConfig } from "../src/config";
import { Store } from "../src/db/store";

const config = buildConfig();
const enabled = process.env.RUN_TESTNET_TESTS === "true" && config.hedera.live && !!config.hedera.payeeAccountId;

describe.runIf(enabled)("Hedera testnet (live)", () => {
  it("approved mission: HCS proofs anchored, 1 HBAR transfer confirmed, Mirror Node verifies, tamper detected", async () => {
    const app = await bootstrap({ config: { ...config, databasePath: ":memory:", ai: { ...config.ai, enabled: false } }, store: new Store(":memory:"), stepDelayMs: 0 });
    try {
      const { missionId } = await app.missions.runScenario("A_APPROVED");
      await app.missions.idle(missionId);
      const s = app.missions.getState(missionId);
      expect(s.mission.status).toBe("PAID");
      expect(s.payments[0]!.hederaTransactionId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
      // Settles in the HTS stablecoin when configured (full amount), otherwise in scaled HBAR.
      expect(s.payments[0]!.settlementCurrency).toBe(config.hedera.stablecoin?.symbol ?? "HBAR");
      expect(s.auditEvents.every((e) => e.anchor.status === "ANCHORED" && e.anchor.transactionId)).toBe(true);
      console.log("payment:", s.payments[0]!.hashscanUrl);

      const report = await app.missions.verifyMission(missionId);
      expect(report.overall).toBe("VALID");
      expect(report.events.every((e) => e.ledger?.source === "MIRROR_NODE")).toBe(true);

      app.missions.tamper(missionId, "REWRITE_HASHES");
      const after = await app.missions.verifyMission(missionId);
      expect(after.overall).toBe("TAMPERING_DETECTED");
      await app.missions.idle(missionId);
    } finally {
      app.close();
    }
  });

  it("blocked mission: GUARDIAN_BLOCKED anchored, no transfer", async () => {
    const app = await bootstrap({ config: { ...config, databasePath: ":memory:", ai: { ...config.ai, enabled: false } }, store: new Store(":memory:"), stepDelayMs: 0 });
    try {
      const { missionId } = await app.missions.runScenario("B_BUDGET_BLOCK");
      await app.missions.idle(missionId);
      const s = app.missions.getState(missionId);
      expect(s.mission.status).toBe("BLOCKED");
      expect(s.payments).toHaveLength(0);
      expect(s.auditEvents.find((e) => e.eventType === "GUARDIAN_BLOCKED")?.anchor.status).toBe("ANCHORED");
    } finally {
      app.close();
    }
  });
});

const vaultEnabled = enabled && config.hedera.vaultConfigured;

describe.runIf(vaultEnabled)("Hedera testnet vault (live)", () => {
  it("above the limit: locked as a 2-of-2 schedule, executed by Hedera only after the approver co-signs", async () => {
    const app = await bootstrap({ config: { ...config, databasePath: ":memory:", ai: { ...config.ai, enabled: false } }, store: new Store(":memory:"), stepDelayMs: 0 });
    try {
      const { missionId } = await app.missions.runScenario("E_HUMAN_REVIEW");
      await app.missions.idle(missionId);
      const locked = app.missions.getState(missionId).payments[0]!;
      expect(locked).toMatchObject({ status: "SCHEDULED", source: "VAULT" });
      expect(locked.scheduleId).toMatch(/^0\.0\.\d+$/);
      console.log("schedule:", locked.scheduleHashscanUrl);
      // Give the Mirror Node a moment, then check the schedule is pending with only the agents' signature.
      await new Promise((r) => setTimeout(r, 6000));
      expect(await app.ledger.fetchSchedule(locked.scheduleId!)).toMatchObject({ executed: false, deleted: false });

      await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Live vault test", actorId: config.operators[0]!, pin: config.operatorPin ?? "0619" });
      await app.missions.idle(missionId);
      const paid = app.missions.getState(missionId).payments[0]!;
      expect(paid.status).toBe("CONFIRMED");
      console.log("payment:", paid.hashscanUrl);
      await new Promise((r) => setTimeout(r, 6000));
      const info = await app.ledger.fetchSchedule(locked.scheduleId!);
      expect(info?.executed).toBe(true);
      expect(info?.signatures).toBeGreaterThanOrEqual(2);
    } finally {
      app.close();
    }
  }, 180_000);
});

describe.skipIf(enabled)("Hedera testnet (skipped)", () => {
  it("skipped: set RUN_TESTNET_TESTS=true and HEDERA_ACCOUNT_ID / HEDERA_PRIVATE_KEY / HEDERA_TOPIC_ID / HEDERA_PAYEE_ACCOUNT_ID", () => {
    expect(enabled).toBe(false);
  });
});
