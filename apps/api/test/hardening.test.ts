import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AiUnavailableError, type AiClient } from "../src/ai/aiClient";
import { createApp } from "../src/app";
import { planMission } from "../src/agents/lem3alem";
import { settlementFor } from "../src/agents/kanawita";
import type { AppServices } from "../src/bootstrap";
import { eventTypes, makeTestApp, runScenarioToRest } from "./helpers";

let app: AppServices;
afterEach(() => app?.close());

const noAi: AiClient = { available: false, model: "x", unavailableReason: "no key", generateStructured: async () => { throw new AiUnavailableError("no"); } };

describe("Trail completeness (ledger listing)", () => {
  it("detects a deleted event even though the remaining local chain is consistent", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    expect((await app.missions.verifyMission(missionId)).overall).toBe("VALID");
    const t = app.missions.tamper(missionId, "DELETE_LAST_EVENT");
    expect(t.eventType).toBe("PAYMENT_CONFIRMED");
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("TAMPERING_DETECTED");
    // every remaining local event is still individually valid…
    expect(report.events.every((e) => e.status === "SIMULATED_VALID")).toBe(true);
    // …but the ledger proves an event that no longer exists locally.
    expect(report.missingLocalEvents.map((m) => m.eventType)).toEqual(["PAYMENT_CONFIRMED"]);
    expect(report.ledgerEventCount).toBe(6);
    await app.missions.idle(missionId);
    const tamperEvent = app.store.listAuditEvents(missionId).find((e) => e.eventType === "TAMPER_DETECTED");
    expect(tamperEvent?.payload.deletedEventTypes).toEqual(["PAYMENT_CONFIRMED"]);
  });

  it("detects altered anchor metadata (pointing an event at a different proof)", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const ev = app.store.listAuditEvents(missionId)[1]!;
    app.store.updateAnchor(ev.eventId, { ...ev.anchor, sequenceNumber: (ev.anchor.sequenceNumber ?? 0) + 1 });
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("TAMPERING_DETECTED");
    expect(report.events[1]!.problems.join(" ")).toMatch(/anchor metadata altered/);
  });

  it("erasing local anchor metadata does not hide anything: the proof is found by eventId and backfilled", async () => {
    app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const ev = app.store.listAuditEvents(missionId)[2]!;
    app.store.updateAnchor(ev.eventId, { ...ev.anchor, sequenceNumber: null, status: "FAILED" });
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("VALID");
    expect(app.store.getAuditEvent(ev.eventId)!.anchor.sequenceNumber).toBe(ev.anchor.sequenceNumber);
  });

  it("does not mix proofs from other missions on the same topic", async () => {
    app = await makeTestApp();
    const a = await runScenarioToRest(app, "A_APPROVED");
    await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const report = await app.missions.verifyMission(a.missionId);
    expect(report.overall).toBe("VALID");
    expect(report.ledgerEventCount).toBe(6);
  });
});

describe("Scenario G — recycled invoice", () => {
  it("a verified, cheap supplier is rejected because its invoice was already used", async () => {
    app = await makeTestApp();
    const { missionId, state } = await runScenarioToRest(app, "G_RECYCLED_INVOICE");
    const offer = state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId)!;
    expect(offer.supplierId).toBe("SUP-KAIROUAN");
    expect(offer.invoiceId).toBe("INV-KQS-2026-0042");
    expect(state.verification?.status).toBe("REJECTED");
    expect(state.verification?.checks.find((c) => c.id === "DUPLICATE_INVOICE")?.passed).toBe(false);
    expect(state.verification?.checks.find((c) => c.id === "SUPPLIER_VERIFIED")?.passed).toBe(true);
    expect(state.guardianDecision?.checks.find((c) => c.id === "DUPLICATE_INVOICE")?.outcome).toBe("BLOCK");
    expect(state.mission.status).toBe("BLOCKED");
    expect(state.payments).toHaveLength(0);
    expect(eventTypes(app, missionId)).toEqual(["MISSION_CREATED", "AI_RECOMMENDATION", "SUPPLIER_REJECTED", "GUARDIAN_BLOCKED"]);
  });

  it("the demo history survives a demo reset", async () => {
    app = await makeTestApp();
    app.store.resetAll();
    app.missions.seedSuppliers();
    const { state } = await runScenarioToRest(app, "G_RECYCLED_INVOICE");
    expect(state.mission.status).toBe("BLOCKED");
  });
});

describe("Operator PIN", () => {
  const review = async () => {
    const { missionId } = await runScenarioToRest(app, "E_HUMAN_REVIEW");
    return missionId;
  };

  it("rejects a wrong PIN and records nothing", async () => {
    app = await makeTestApp();
    const id = await review();
    await expect(app.missions.submitApproval(id, { decision: "APPROVED", reason: "looks fine to me", actorId: "ops-lead", pin: "1111" })).rejects.toThrow(/Invalid operator PIN/);
    expect(app.store.getApproval(id)).toBeNull();
    expect(app.store.listPayments(id)).toHaveLength(0);
  });

  it("locks the mission after 5 wrong PINs", async () => {
    app = await makeTestApp();
    const id = await review();
    for (let i = 0; i < 5; i++) await expect(app.missions.submitApproval(id, { decision: "APPROVED", reason: "guessing the pin", actorId: "ops-lead", pin: `99${i}9` })).rejects.toThrow();
    await expect(app.missions.submitApproval(id, { decision: "APPROVED", reason: "right pin, too late", actorId: "ops-lead", pin: "0619" })).rejects.toThrow(/Too many wrong PINs/);
  });

  it("uses DEMO_OPERATOR_PIN when configured", async () => {
    app = await makeTestApp({ env: { DEMO_OPERATOR_PIN: "4242" } });
    const id = await review();
    await expect(app.missions.submitApproval(id, { decision: "APPROVED", reason: "old default pin", actorId: "ops-lead", pin: "0619" })).rejects.toThrow(/Invalid/);
    await app.missions.submitApproval(id, { decision: "APPROVED", reason: "configured pin", actorId: "ops-lead", pin: "4242" });
    await app.missions.idle(id);
    expect(app.missions.getState(id).mission.status).toBe("PAID");
  });

  it("approvals are disabled outside demo mode unless a PIN is configured", async () => {
    app = await makeTestApp({ env: { DEMO_MODE: "false" } });
    const id = await review();
    await expect(app.missions.submitApproval(id, { decision: "APPROVED", reason: "no pin configured", actorId: "ops-lead", pin: "0619" })).rejects.toThrow(/DEMO_OPERATOR_PIN/);
  });

  it("HTTP: wrong PIN → 403, PIN never exposed in public config", async () => {
    app = await makeTestApp();
    const http = createApp(app);
    const id = await review();
    const res = await request(http).post(`/api/missions/${id}/approvals`).send({ decision: "APPROVED", reason: "wrong pin over http", actorId: "ops-lead", pin: "0000" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_PIN");
    const cfg = await request(http).get("/api/config");
    expect(cfg.body.operatorAuth).toBe("DEMO_PIN");
    expect(JSON.stringify(cfg.body)).not.toContain("0619");
  });
});

describe("Settlement is tied to the authorized amount", () => {
  it("scales with the offer and is capped", () => {
    expect(settlementFor(4150, 0.25, 10)).toBe(1.0375);
    expect(settlementFor(16600, 0.25, 10)).toBe(4.15);
    expect(settlementFor(1_000_000, 0.25, 10)).toBe(10);
    expect(settlementFor(0.01, 0.25, 10)).toBe(0.0001);
  });
});

describe("Budgets in Tunisian dinars", () => {
  it("converts TND with the configured demo rate and says so", async () => {
    const r = await planMission({ text: "300 people in Sfax need drinking water, budget 15,500 TND within 48 hours" }, noAi, { tndPerUsd: 3.1 });
    expect(r.status).toBe("CREATED");
    expect(r.draft?.maximumBudget).toBe(5000);
    expect(r.notes.join(" ")).toMatch(/converted from 15,500 TND at 3\.1 TND\/USD/);
  });
});

describe("Lighter polling responses", () => {
  it("off-chain payloads are omitted unless requested", async () => {
    app = await makeTestApp();
    const http = createApp(app);
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const lite = await request(http).get(`/api/missions/${missionId}`);
    expect(lite.body.auditEvents.every((e: { payload: object }) => Object.keys(e.payload).length === 0)).toBe(true);
    const full = await request(http).get(`/api/missions/${missionId}?payloads=1`);
    expect(Object.keys(full.body.auditEvents[0].payload).length).toBeGreaterThan(0);
    expect(lite.headers.etag).toBeTruthy(); // lets the browser revalidate cheaply (304)
  });
});
