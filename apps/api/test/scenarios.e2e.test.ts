import { afterEach, describe, expect, it } from "vitest";
import type { AppServices } from "../src/bootstrap";
import { eventTypes, makeTestApp, runScenarioToRest } from "./helpers";

let app: AppServices;
afterEach(() => app?.close());

describe("Scenario A — approved mission", () => {
  it("researches, verifies, approves, pays once and anchors every decision", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "A_APPROVED");
    expect(state.mission.status).toBe("PAID");
    expect(state.guardianDecision?.decision).toBe("APPROVED");
    expect(state.guardianDecision?.riskLevel).toBe("LOW");
    expect(state.verification?.status).toBe("VERIFIED");
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]!.status).toBe("CONFIRMED");
    expect(state.payments[0]!.settlementAmount).toBe(0.996); // 12,450 TND / 1000 * 0.08 HBAR
    expect(state.payments[0]!.hederaTransactionId).toBeNull(); // simulated ledger never invents tx ids
    expect(eventTypes(app, missionId)).toEqual(["MISSION_CREATED", "AI_RECOMMENDATION", "SUPPLIER_VERIFIED", "GUARDIAN_APPROVED", "PAYMENT_INITIATED", "PAYMENT_CONFIRMED"]);
    expect(state.auditEvents.every((e) => e.anchor.status === "SIMULATED")).toBe(true);
    const lemhaf = state.agentRuns.find((r) => r.agent === "LEMHAF")!;
    expect(lemhaf.mode).toBe("FALLBACK");
    expect(lemhaf.fallbackReason).toMatch(/disabled|not configured/);
    const supplier = state.suppliers.find((s) => s.supplierId === state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId)?.supplierId);
    expect(supplier?.verified).toBe(true);

    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("VALID");
    expect(report.events.every((e) => e.status === "SIMULATED_VALID")).toBe(true);
  });
});

describe("Scenario B — budget block", () => {
  it("blocks on budget, never runs payment, and logs the block", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    expect(state.mission.status).toBe("BLOCKED");
    expect(state.guardianDecision?.decision).toBe("BLOCKED");
    expect(state.guardianDecision?.checks.find((c) => c.id === "BUDGET")?.outcome).toBe("BLOCK");
    expect(state.payments).toHaveLength(0);
    expect(eventTypes(app, missionId)).toContain("GUARDIAN_BLOCKED");
    expect(eventTypes(app, missionId)).not.toContain("PAYMENT_INITIATED");
    expect(state.agentRuns.some((r) => r.agent === "KANAWITA")).toBe(false);
  });
});

describe("Scenario C — duplicate payment attack", () => {
  it("rejects a replay of the same payment and records the attempt", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "C_DUPLICATE_PAYMENT");
    expect(app.missions.getState(missionId).mission.status).toBe("PAID");
    const replay = await app.missions.replayPayment(missionId);
    expect(replay.executed).toBe(false);
    expect(replay.reasons.join(" ")).toMatch(/already PAID|Idempotency key already used|already exists/);
    const again = await app.missions.replayPayment(missionId);
    expect(again.executed).toBe(false);
    const state = app.missions.getState(missionId);
    expect(state.payments).toHaveLength(1);
    expect(eventTypes(app, missionId).filter((t) => t === "PAYMENT_BLOCKED")).toHaveLength(2);
  });

  it("two concurrent executions produce exactly one payment", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Verified need, approved", actorId: "ops-lead", pin: "0619" });
    const [a, b] = await Promise.all([app.missions.kanawita.execute(missionId, "REPLAY"), app.missions.kanawita.execute(missionId, "REPLAY")]);
    await app.missions.idle(missionId);
    const live = app.store.listPayments(missionId).filter((p) => p.status !== "FAILED");
    expect(live).toHaveLength(1);
    expect([a.executed, b.executed].filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("the database itself refuses a second payment with the same idempotency key", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "A_APPROVED");
    const p = state.payments[0]!;
    expect(() => app.store.insertPayment({ ...p, paymentId: "pay_dup", missionId: `${missionId}_x`, invoiceId: "other" })).toThrow(/Duplicate payment/);
    expect(() => app.store.insertPayment({ ...p, paymentId: "pay_dup2", idempotencyKey: "different" })).toThrow(/Duplicate payment/);
  });
});

describe("Scenario D — unverified supplier", () => {
  it("AI picks the attractive offer, NASNES rejects it, 3ASES blocks, no payment", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "D_UNVERIFIED_SUPPLIER");
    const offer = state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId)!;
    expect(offer.supplierId).toBe("SUP-SAHEL");
    expect(state.verification?.status).toBe("REJECTED");
    expect(state.verification?.checks.find((c) => c.id === "SUPPLIER_VERIFIED")?.passed).toBe(false);
    expect(state.verification?.checks.find((c) => c.id === "EVIDENCE")?.passed).toBe(false);
    expect(state.guardianDecision?.decision).toBe("BLOCKED");
    expect(state.guardianDecision?.checks.find((c) => c.id === "SUPPLIER_VERIFIED")?.outcome).toBe("BLOCK");
    expect(state.payments).toHaveLength(0);
    expect(eventTypes(app, missionId)).toEqual(["MISSION_CREATED", "AI_RECOMMENDATION", "SUPPLIER_REJECTED", "GUARDIAN_BLOCKED"]);
  });

  it("KANAWITA refuses even if called directly on the blocked mission", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "D_UNVERIFIED_SUPPLIER");
    const out = await app.missions.kanawita.execute(missionId, "AUTO");
    expect(out.executed).toBe(false);
    expect(out.reasons.join(" ")).toMatch(/NASNES result is REJECTED/);
    expect(app.store.listPayments(missionId)).toHaveLength(0);
  });
});

describe("Scenario E — high-risk human review", () => {
  it("stops for review, then pays only after a valid approval", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    expect(state.mission.status).toBe("HUMAN_REVIEW");
    expect(state.guardianDecision?.decision).toBe("HUMAN_REVIEW_REQUIRED");
    expect(state.guardianDecision?.riskLevel).toBe("HIGH");
    // The payment is locked in the 2-of-2 vault: signed by the agents only, not executed.
    expect(state.payments).toHaveLength(1);
    const locked = state.payments[0]!;
    expect(locked).toMatchObject({ status: "SCHEDULED", source: "VAULT" });
    expect(await app.ledger.fetchSchedule(locked.scheduleId!)).toMatchObject({ executed: false, deleted: false, signatures: 1 });

    // KANAWITA cannot be tricked into paying before the human decides.
    const early = await app.missions.kanawita.execute(missionId, "AUTO");
    expect(early.executed).toBe(false);
    expect(early.reasons.join(" ")).toMatch(/HUMAN_REVIEW_REQUIRED|human approval/i);

    await expect(app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "I am not allowed", actorId: "random-user", pin: "0619" })).rejects.toThrow(/not an authorized operator/);

    await app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "Need confirmed by field team", actorId: "ops-lead", pin: "0619" });
    await app.missions.idle(missionId);
    const after = app.missions.getState(missionId);
    expect(after.mission.status).toBe("PAID");
    expect(after.guardianDecision?.decision).toBe("APPROVED");
    expect(after.guardianDecision?.approvalId).toBe(after.approvals[0]!.approvalId);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ status: "CONFIRMED", source: "VAULT", scheduleId: locked.scheduleId });
    expect(await app.ledger.fetchSchedule(locked.scheduleId!)).toMatchObject({ executed: true, signatures: 2 });
    expect(eventTypes(app, missionId)).toEqual([
      "MISSION_CREATED", "AI_RECOMMENDATION", "SUPPLIER_VERIFIED", "HUMAN_REVIEW_REQUIRED", "PAYMENT_SCHEDULED", "PAYMENT_BLOCKED", "HUMAN_APPROVED", "GUARDIAN_APPROVED", "PAYMENT_INITIATED", "PAYMENT_CONFIRMED",
    ]);
    await expect(app.missions.submitApproval(missionId, { decision: "APPROVED", reason: "second time", actorId: "ops-lead", pin: "0619" })).rejects.toThrow(/not awaiting human review/);
  });

  it("a rejection ends the mission with no payment", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    await app.missions.submitApproval(missionId, { decision: "REJECTED", reason: "Duplicate request from another NGO", actorId: "field-coordinator", pin: "0619" });
    await app.missions.idle(missionId);
    const s = app.missions.getState(missionId);
    expect(s.mission.status).toBe("REJECTED");
    expect(s.guardianDecision?.decision).toBe("BLOCKED");
    // The vault schedule is deleted on the ledger: the funds are never released.
    expect(s.payments.map((p) => p.status)).toEqual(["CANCELLED"]);
    expect(await app.ledger.fetchSchedule(s.payments[0]!.scheduleId!)).toMatchObject({ executed: false, deleted: true });
    expect(eventTypes(app, missionId)).toContain("HUMAN_REJECTED");
    expect(eventTypes(app, missionId).at(-1)).toBe("PAYMENT_CANCELLED");
  });
});

describe("Scenario F — tampering detection", () => {
  it("detects edited evidence (local hash check + ledger)", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "F_TAMPERING");
    expect((await app.missions.verifyMission(missionId)).overall).toBe("VALID");
    const t = app.missions.tamper(missionId, "EDIT_EVIDENCE");
    expect(t.eventType).toBe("GUARDIAN_APPROVED");
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("TAMPERING_DETECTED");
    const bad = report.events.find((e) => e.eventId === t.eventId)!;
    expect(bad.status).toBe("TAMPERED");
    expect(bad.checks.evidenceHashIntact).toBe(false);
    expect(bad.checks.matchesLedger).toBe(false);
    await app.missions.idle(missionId);
    expect(eventTypes(app, missionId)).toContain("TAMPER_DETECTED");
    // Re-verifying does not spam duplicate TAMPER_DETECTED events.
    await app.missions.verifyMission(missionId);
    await app.missions.idle(missionId);
    expect(eventTypes(app, missionId).filter((x) => x === "TAMPER_DETECTED")).toHaveLength(1);
  });

  it("detects an insider who also recomputed the local hash chain — only the ledger catches it", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "F_TAMPERING");
    const t = app.missions.tamper(missionId, "REWRITE_HASHES");
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("TAMPERING_DETECTED");
    const bad = report.events.find((e) => e.eventId === t.eventId)!;
    // A plain database audit would pass: hashes and links are self-consistent locally...
    expect(bad.checks.evidenceHashIntact).toBe(true);
    expect(bad.checks.eventHashIntact).toBe(true);
    expect(bad.checks.chainLinkValid).toBe(true);
    // ...but the consensus record disagrees.
    expect(bad.checks.matchesLedger).toBe(false);
  });

  it("tampering is refused outside demo mode", async () => {
    app = await makeTestApp({ env: { DEMO_MODE: "false" } });
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    expect(() => app.missions.tamper(missionId, "EDIT_EVIDENCE")).toThrow(/demo/);
  });
});

describe("Failure handling", () => {
  it("a failed transfer is recorded as PAYMENT_FAILED and never marked paid", async () => {
    app = await makeTestApp();
    const sim = (app as AppServices & { sim: { failNextTransfer: boolean } }).sim;
    sim.failNextTransfer = true;
    const { missionId, state } = await runScenarioToRest(app, "A_APPROVED");
    expect(state.mission.status).toBe("PAYMENT_FAILED");
    expect(state.payments[0]!.status).toBe("FAILED");
    expect(state.payments[0]!.confirmedAt).toBeNull();
    expect(eventTypes(app, missionId)).toContain("PAYMENT_FAILED");
    expect(eventTypes(app, missionId)).not.toContain("PAYMENT_CONFIRMED");
  });

  it("HCS outage: anchor retried once then marked FAILED; the server keeps running", async () => {
    app = await makeTestApp();
    const sim = (app as AppServices & { sim: { failNextSubmits: number } }).sim;
    sim.failNextSubmits = 2; // first event fails both attempts
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const events = app.store.listAuditEvents(missionId);
    expect(events[0]!.anchor.status).toBe("FAILED");
    expect(events[0]!.anchor.error).toMatch(/HCS submit failed/);
    expect(events[1]!.anchor.status).toBe("SIMULATED");
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("UNVERIFIABLE");
  });

  it("free-text request without a budget returns NEEDS_INFORMATION and never starts the pipeline", async () => {
    app = await makeTestApp();
    const out = await app.missions.createMission({ text: "We need water for 300 people in Sfax as soon as possible" });
    expect(out.status).toBe("NEEDS_INFORMATION");
    expect(out.missingFields).toContain("maximumBudget");
    expect(app.store.listAuditEvents(out.missionId)).toHaveLength(0);
  });
});
