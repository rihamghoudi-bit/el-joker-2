import { createHash } from "node:crypto";
import { isLivePayment, parseLedgerRecord, verifyBundle } from "@eljoker/shared";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { settlementAmount } from "../src/agents/kanawita";
import { eventTypes, makeTestApp, runScenarioToRest } from "./helpers";

type TestApp = Awaited<ReturnType<typeof makeTestApp>>;
let app: TestApp;
afterEach(() => app?.close());

const nodeSha = async (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("Second use case — ACME company procurement (same agents, another policy)", () => {
  it("H: office supplies inside ACME's 6,000 TND limit are paid autonomously under ACME policy 1.1.0", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "H_ACME_SUPPLIES");
    expect(state.mission.organizationId).toBe("ACME_PROCUREMENT");
    expect(state.mission.status).toBe("PAID");
    expect(state.payments[0]).toMatchObject({ status: "CONFIRMED", source: "OPERATOR" });
    expect(state.guardianDecision?.policyVersion).toMatch(/^1\.1\.0\+/);
    expect(state.guardianDecision?.checks.find((c) => c.id === "TRANSACTION_LIMIT")?.detail).toMatch(/6,000 TND/);
    // Every proof of this mission carries ACME's policy version, on the same ledger topic as the NGO.
    expect(app.store.listAuditEvents(missionId).every((e) => e.policyVersion.startsWith("1.1.0+"))).toBe(true);
  });

  it("I: laptops above ACME's limit go to human review and the vault", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "I_ACME_LAPTOPS");
    expect(state.mission.status).toBe("HUMAN_REVIEW");
    expect(state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId)?.totalPrice).toBe(35460);
    expect(state.payments).toMatchObject([{ status: "SCHEDULED", source: "VAULT" }]);
    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Budget line ENG-2026 approved", actorId: "ops-lead", pin: "0619" });
    await app.missions.idle(missionId);
    expect(app.missions.getState(missionId).mission.status).toBe("PAID");
  });

  it("the NGO policy cannot buy laptops, and the ACME policy cannot buy medicine", async () => {
    app = await makeTestApp();
    expect(app.policies.get("NGO_RELIEF").allowedCategories).not.toContain("ELECTRONICS");
    expect(app.policies.get("ACME_PROCUREMENT").allowedCategories).not.toContain("MEDICINE");
    expect(app.policies.get("ACME_PROCUREMENT").autonomousLimit).toBe(6000);
    expect(app.policies.get("NGO_RELIEF").effectiveVersion).not.toBe(app.policies.get("ACME_PROCUREMENT").effectiveVersion);
  });

  it("free text naming ACME is planned for ACME", async () => {
    app = await makeTestApp();
    const out = await app.missions.createMission({ text: "ACME Tunisia: 12 laptops for 12 employees in Tunis. Budget: 45,000 TND. Delivery within 7 days." });
    expect(app.store.getMission(out.missionId)?.organizationId).toBe("ACME_PROCUREMENT");
  });
});

describe("Hedera vault — the approval is enforced by the ledger", () => {
  it("the agents' signature alone never executes a vault payment", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    const p = state.payments[0]!;
    expect(await app.ledger.fetchSchedule(p.scheduleId!)).toMatchObject({ executed: false, signatures: 1 });
    // Nothing counts as paid while the schedule waits.
    expect(app.store.listPayments(missionId).filter(isLivePayment)).toHaveLength(0);
    const early = await app.missions.kanawita.execute(missionId, "AUTO");
    expect(early.executed).toBe(false);
    expect(await app.ledger.fetchSchedule(p.scheduleId!)).toMatchObject({ executed: false, signatures: 1 });
  });

  it("locking the payment does not invalidate the approval (bound facts unchanged)", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    await expect(app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Confirmed by the field team", actorId: "ops-lead", pin: "0619" })).resolves.toBeDefined();
  });

  it("if locking fails at review time, the payment is locked at approval time and still needs both signatures", async () => {
    app = await makeTestApp();
    app.sim!.failNextSchedule = true;
    const { missionId, state } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    expect(state.payments).toHaveLength(0);
    expect(state.feed.some((m) => m.chips.includes("VAULT LOCK FAILED"))).toBe(true);
    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Confirmed by the field team", actorId: "ops-lead", pin: "0619" });
    await app.missions.idle(missionId);
    const after = app.missions.getState(missionId);
    expect(after.mission.status).toBe("PAID");
    expect(after.payments).toMatchObject([{ status: "CONFIRMED", source: "VAULT" }]);
    expect(await app.ledger.fetchSchedule(after.payments[0]!.scheduleId!)).toMatchObject({ executed: true, signatures: 2 });
  });

  it("an expired schedule is locked again and co-signed on the same payment", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    const first = state.payments[0]!.scheduleId!;
    // Simulate Hedera expiring the schedule before the human answers.
    app.store.updateSimulatedSchedule(first, { ...app.store.getSimulatedSchedule(first)!, deleted: true });
    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Confirmed by the field team", actorId: "ops-lead", pin: "0619" });
    await app.missions.idle(missionId);
    const after = app.missions.getState(missionId);
    expect(after.mission.status).toBe("PAID");
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]!.scheduleId).not.toBe(first);
    expect(eventTypes(app, missionId).filter((t) => t === "PAYMENT_SCHEDULED")).toHaveLength(2);
  });

  it("a replay after a vault payment is refused", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Confirmed by the field team", actorId: "ops-lead", pin: "0619" });
    await app.missions.idle(missionId);
    const replay = await app.missions.replayPayment(missionId);
    expect(replay.executed).toBe(false);
    expect(app.store.listPayments(missionId)).toHaveLength(1);
  });

  it("settles the full offer amount in the stablecoin, or a scaled amount in HBAR", () => {
    expect(settlementAmount(49800, { kind: "TOKEN", symbol: "EJTND", tokenId: "0.0.1", decimals: 3 }, 0.08, 10)).toBe(49800);
    expect(settlementAmount(1234.5678, { kind: "TOKEN", symbol: "EJTND", tokenId: "0.0.1", decimals: 3 }, 0.08, 10)).toBe(1234.568);
    expect(settlementAmount(49800, { kind: "HBAR", symbol: "HBAR" }, 0.08, 10)).toBe(3.984);
  });
});

describe("Public verifier — recompute everything without trusting the server", () => {
  it("a clean mission verifies, and the ledger chain alone is unbroken", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    const bundle = await app.missions.getProofBundle(missionId);
    expect(bundle.events).toHaveLength(6);
    const v = await verifyBundle(bundle, bundle.simulatedLedger!, nodeSha);
    expect(v.overall).toBe("VALID");
    expect(v.ledgerChain).toEqual({ count: 6, contiguous: true, linked: true });
    expect(v.events.every((e) => e.status === "VALID")).toBe(true);
  });

  it("an insider who rewrites the evidence and every hash is caught", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "F_TAMPERING");
    app.missions.tamper(missionId, "REWRITE_HASHES");
    const bundle = await app.missions.getProofBundle(missionId);
    const v = await verifyBundle(bundle, bundle.simulatedLedger!, nodeSha);
    expect(v.overall).toBe("TAMPERING_DETECTED");
    const bad = v.events.filter((e) => e.status === "TAMPERED");
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((e) => e.checks.matchesLedger === false)).toBe(true);
  });

  it("a deleted event is caught from the ledger listing", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "F_TAMPERING");
    app.missions.tamper(missionId, "DELETE_LAST_EVENT");
    const bundle = await app.missions.getProofBundle(missionId);
    const v = await verifyBundle(bundle, bundle.simulatedLedger!, nodeSha);
    expect(v.overall).toBe("TAMPERING_DETECTED");
    expect(v.missingFromBundle.map((m) => m.eventType)).toEqual(["PAYMENT_CONFIRMED"]);
  });

  it("a forged ledger copy (a different hash) does not verify", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    const bundle = await app.missions.getProofBundle(missionId);
    const forged = bundle.simulatedLedger!.map((c) => {
      const r = parseLedgerRecord(c.message);
      return r?.t === "GUARDIAN_APPROVED" ? { ...c, message: c.message.replace(r.h, "f".repeat(64)) } : c;
    });
    expect((await verifyBundle(bundle, forged, nodeSha)).overall).toBe("TAMPERING_DETECTED");
  });

  it("GET /api/public/missions/:id/bundle serves the bundle (no secrets)", async () => {
    app = await makeTestApp({ env: { ANTHROPIC_API_KEY: "sk-ant-should-not-leak", AI_ENABLED: "true" } });
    const { missionId } = await runScenarioToRest(app, "H_ACME_SUPPLIES");
    const res = await request(createApp(app)).get(`/api/public/missions/${missionId}/bundle`);
    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe("ACME_PROCUREMENT");
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-ant|PRIVATE_KEY/i);
    expect((await request(createApp(app)).get("/api/public/missions/nope/bundle")).status).toBe(404);
  });

  it("public config exposes the vault, the settlement asset and both policies", async () => {
    app = await makeTestApp();
    const cfg = (await request(createApp(app)).get("/api/config")).body;
    expect(cfg.hedera.vault).toMatchObject({ enabled: true, threshold: expect.stringMatching(/2-of-2/) });
    expect(cfg.payment).toMatchObject({ asset: "HBAR", symbol: "HBAR" });
    expect(cfg.policies.map((p: { organizationId: string }) => p.organizationId).sort()).toEqual(["ACME_PROCUREMENT", "NGO_RELIEF"]);
  });
});
