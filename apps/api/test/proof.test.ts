import { describe, expect, it } from "vitest";
import { buildLedgerMessage, computeEventHash, GENESIS_HASH, parseLedgerMessage } from "../src/audit/proofService";
import { buildConfig } from "../src/config";
import { MirrorNodeClient, toMirrorTxId } from "../src/hedera/mirror";
import { canonicalize, hashCanonical, sha256Hex } from "../src/lib/canonical";
import { redact } from "../src/logger";
import { eventTypes, makeTestApp, runScenarioToRest } from "./helpers";

describe("canonical hashing", () => {
  it("is independent of key order and whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }));
  });
  it("uses standard SHA-256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("rejects values JSON cannot represent faithfully", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow();
    expect(() => canonicalize([undefined])).toThrow();
  });
  it("any change to the evidence changes the hash", () => {
    expect(hashCanonical({ price: 4150 })).not.toBe(hashCanonical({ price: 4151 }));
  });
});

describe("audit chain + Hedera payload", () => {
  it("links every event to the previous one (genesis first)", async () => {
    const app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    const events = app.store.listAuditEvents(missionId);
    expect(events[0]!.previousEventHash).toBe(GENESIS_HASH);
    for (let i = 1; i < events.length; i++) expect(events[i]!.previousEventHash).toBe(events[i - 1]!.eventHash);
    for (const e of events) {
      expect(e.evidenceHash).toBe(hashCanonical(e.payload));
      const { payload: _p, anchor: _a, summary: _s, eventHash, ...header } = e;
      expect(computeEventHash(header)).toBe(eventHash);
    }
    app.close();
  });

  it("ledger message is small and carries only ids + hashes (no beneficiary data, prices or documents)", async () => {
    const app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "A_APPROVED");
    for (const e of app.store.listAuditEvents(missionId)) {
      const msg = buildLedgerMessage(e);
      expect(Buffer.byteLength(msg)).toBeLessThan(1024); // single HCS chunk
      const rec = parseLedgerMessage(msg)!;
      expect(Object.keys(rec).sort()).toEqual(["e", "eh", "h", "m", "p", "ph", "pv", "s", "t", "ts", "v"]);
      expect(msg).not.toMatch(/Gabès|beneficiar|description|price|INV-/i);
    }
    app.close();
  });

  it("verifyMissionTrail is VALID before tampering; trail events are verified one by one", async () => {
    const app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("VALID");
    expect(report.events).toHaveLength(eventTypes(app, missionId).length);
    app.close();
  });
});

describe("Mirror Node client", () => {
  const fakeFetch = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it("decodes base64 topic messages", async () => {
    const client = new MirrorNodeClient("https://mirror", fakeFetch(200, { message: Buffer.from('{"p":"eljoker"}').toString("base64"), consensus_timestamp: "1.2", sequence_number: 7, topic_id: "0.0.5" }));
    const m = await client.getTopicMessage("0.0.5", 7);
    expect(m).toEqual({ source: "MIRROR_NODE", topicId: "0.0.5", sequenceNumber: 7, consensusTimestamp: "1.2", message: '{"p":"eljoker"}' });
  });
  it("returns null when not indexed yet (404)", async () => {
    expect(await new MirrorNodeClient("https://mirror", fakeFetch(404, {})).getTopicMessage("0.0.5", 1)).toBeNull();
  });
  it("throws on server errors (caller marks verification PENDING)", async () => {
    await expect(new MirrorNodeClient("https://mirror", fakeFetch(503, {})).getTopicMessage("0.0.5", 1)).rejects.toThrow(/503/);
  });
  it("converts transaction ids to Mirror Node format", () => {
    expect(toMirrorTxId("0.0.1234@1700000000.123456789")).toBe("0.0.1234-1700000000-123456789");
  });
  it("verification reports PENDING (not VALID) when the Mirror Node is unreachable", async () => {
    const app = await makeTestApp();
    const { missionId } = await runScenarioToRest(app, "B_BUDGET_BLOCK");
    const down = async () => {
      throw new Error("ECONNREFUSED");
    };
    Object.assign(app.ledger, { fetchTopicMessage: down, listTopicMessages: down });
    const report = await app.missions.verifyMission(missionId);
    expect(report.overall).toBe("PENDING");
    expect(report.events[0]!.problems.join(" ")).toMatch(/ECONNREFUSED/);
    app.close();
  });
});

describe("configuration safety", () => {
  it("refuses any network other than testnet", () => {
    expect(() => buildConfig({ HEDERA_NETWORK: "mainnet" } as NodeJS.ProcessEnv)).toThrow(/testnet/);
  });
  it("demo-only tools are disabled in production", () => {
    expect(buildConfig({ NODE_ENV: "production", DEMO_MODE: "true" } as NodeJS.ProcessEnv).demoMode).toBe(false);
  });
  it("live Hedera mode needs account, key and topic", () => {
    expect(buildConfig({ HEDERA_ACCOUNT_ID: "0.0.1" } as NodeJS.ProcessEnv).hedera.live).toBe(false);
  });
  it("logger redacts secrets", () => {
    const out = JSON.stringify(redact({ HEDERA_PRIVATE_KEY: "302e020100300506032b657004220420abcdef", apiKey: "sk-ant-xyz", note: "key sk-ant-abc123 leaked", evidenceHash: "abc" }));
    expect(out).not.toMatch(/sk-ant-|302e0201/);
    expect(out).toContain("abc"); // hashes are not secrets
  });
});
