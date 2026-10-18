import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppServices } from "../src/bootstrap";
import { makeTestApp } from "./helpers";

let svc: AppServices;
afterEach(() => svc?.close());

describe("HTTP API", () => {
  it("health + public config never leak secrets", async () => {
    svc = await makeTestApp({ env: { ANTHROPIC_API_KEY: "sk-ant-should-not-leak", AI_ENABLED: "true" } });
    const app = createApp(svc);
    expect((await request(app).get("/api/health")).body.ok).toBe(true);
    const cfg = await request(app).get("/api/config");
    expect(cfg.status).toBe(200);
    expect(JSON.stringify(cfg.body)).not.toMatch(/sk-ant|PRIVATE/i);
    expect(cfg.body.hedera.mode).toBe("SIMULATED");
    expect(cfg.body.policy.autonomousLimit).toBe(15000);
  });

  it("lists the nine scenarios, for two organizations", async () => {
    svc = await makeTestApp();
    const res = await request(createApp(svc)).get("/api/scenarios");
    expect(res.body.map((s: { letter: string }) => s.letter)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect(new Set(res.body.map((s: { organizationId: string }) => s.organizationId))).toEqual(new Set(["NGO_RELIEF", "ACME_PROCUREMENT"]));
  });

  it("POST /api/scenarios/:id/run returns immediately with a missionId (202)", async () => {
    svc = await makeTestApp();
    const app = createApp(svc);
    const res = await request(app).post("/api/scenarios/A_APPROVED/run");
    expect(res.status).toBe(202);
    await svc.missions.idle(res.body.missionId);
    const state = await request(app).get(`/api/missions/${res.body.missionId}`);
    expect(state.body.mission.status).toBe("PAID");
    const replay = await request(app).post(`/api/missions/${res.body.missionId}/payments/replay`);
    expect(replay.status).toBe(409);
    expect(replay.body.executed).toBe(false);
  });

  it("validates input and returns structured errors", async () => {
    svc = await makeTestApp();
    const app = createApp(svc);
    expect((await request(app).post("/api/missions").send({})).status).toBe(400);
    expect((await request(app).post("/api/missions/nope/approvals").send({ decision: "APPROVED", reason: "x", actorId: "ops-lead" })).body.code).toBe("VALIDATION_ERROR");
    expect((await request(app).get("/api/missions/nope")).status).toBe(404);
    expect((await request(app).post("/api/scenarios/Z/run")).status).toBe(404);
    expect((await request(app).post("/api/missions").set("content-type", "application/json").send("{bad")).status).toBe(400);
  });

  it("tamper and reset endpoints are refused outside demo mode", async () => {
    svc = await makeTestApp({ env: { DEMO_MODE: "false" } });
    const app = createApp(svc);
    const { missionId } = await svc.missions.runScenario("A_APPROVED");
    await svc.missions.idle(missionId);
    expect((await request(app).post(`/api/missions/${missionId}/tamper`).send({})).status).toBe(403);
    expect((await request(app).post("/api/demo/reset")).status).toBe(403);
  });

  it("approval by an unknown operator is forbidden", async () => {
    svc = await makeTestApp();
    const app = createApp(svc);
    const { missionId } = await svc.missions.runScenario("E_HUMAN_REVIEW");
    await svc.missions.idle(missionId);
    const res = await request(app).post(`/api/missions/${missionId}/approvals`).send({ decision: "APPROVED", reason: "trust me please", actorId: "intruder", pin: "0619" });
    expect(res.status).toBe(403);
    // Only the vault reservation exists, still locked and waiting for the approver.
    expect(svc.store.listPayments(missionId).map((p) => p.status)).toEqual(["SCHEDULED"]);
  });
});
