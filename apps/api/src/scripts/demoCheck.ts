/**
 * Runs every jury scenario (NGO A–G, ACME H–I) plus the public verification against a RUNNING API (default http://localhost:4000) and prints a report.
 * Usage: npm run demo:check            (API must be running: npm run dev)
 *        API_URL=http://host:4000 npm run demo:check
 * Note: with Hedera credentials configured this spends a few testnet HBAR (HCS fees + 1 HBAR demo settlements).
 */
import { createHash } from "node:crypto";
import { type LedgerCopy, type MissionState, type ProofBundle, type PublicConfig, type TrailVerification, verifyBundle } from "@eljoker/shared";

const API = process.env.API_URL ?? "http://localhost:4000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as T };
}

async function waitFor(missionId: string, done: (s: MissionState) => boolean, timeoutMs = 180_000): Promise<MissionState> {
  const start = Date.now();
  for (;;) {
    const { body } = await call<MissionState>(`/api/missions/${missionId}`);
    const settled = !body.busy && !body.auditEvents.some((e) => e.anchor.status === "PENDING");
    if (settled && done(body)) return body;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${missionId} (status ${body.mission.status})`);
    await sleep(1000);
  }
}

const results: { scenario: string; ok: boolean; detail: string }[] = [];
function record(scenario: string, ok: boolean, detail: string) {
  results.push({ scenario, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${scenario.padEnd(28)} ${detail}`);
}
const types = (s: MissionState) => s.auditEvents.map((e) => e.eventType).join(" → ");
const run = async (id: string) => (await call<{ missionId: string }>(`/api/scenarios/${id}/run`, "POST")).body.missionId;

const cfg = (await call<PublicConfig>("/api/config")).body;
console.log(`EL JOKER demo check · API ${API} · ledger ${cfg.hedera.mode}${cfg.hedera.topicId ? ` (topic ${cfg.hedera.topicId})` : ""} · AI ${cfg.ai.configured ? `REAL (${cfg.ai.model})` : "FALLBACK"}\n`);

// A
{
  const id = await run("A_APPROVED");
  const s = await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "FAILED"].includes(x.mission.status));
  const p = s.payments[0];
  const v = (await call<TrailVerification>(`/api/missions/${id}/verify`, "POST")).body;
  const lemhaf = s.agentRuns.find((r) => r.agent === "LEMHAF");
  record("A approved", s.mission.status === "PAID" && p?.status === "CONFIRMED" && v.overall === "VALID", `${s.mission.status} · ${p?.hederaTransactionId ?? "simulated"} · proof ${v.overall} · LEMHAF ${lemhaf?.mode}${lemhaf?.fallbackReason ? ` (${lemhaf.fallbackReason})` : ""}`);
  if (p?.hashscanUrl) console.log(`      payment: ${p.hashscanUrl}`);
  console.log(`      events: ${types(s)}`);
}
// B
{
  const id = await run("B_BUDGET_BLOCK");
  const s = await waitFor(id, (x) => ["BLOCKED", "FAILED", "PAID"].includes(x.mission.status));
  record("B budget block", s.mission.status === "BLOCKED" && s.payments.length === 0 && s.auditEvents.some((e) => e.eventType === "GUARDIAN_BLOCKED"), `${s.mission.status} · payments ${s.payments.length} · ${types(s)}`);
}
// C
{
  const id = await run("C_DUPLICATE_PAYMENT");
  await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "FAILED"].includes(x.mission.status));
  const replay = await call<{ executed: boolean; reasons: string[] }>(`/api/missions/${id}/payments/replay`, "POST");
  const s = await waitFor(id, () => true);
  record("C duplicate payment", replay.status === 409 && !replay.body.executed && s.payments.length === 1, `replay HTTP ${replay.status} · "${replay.body.reasons[0]}" · payments ${s.payments.length}`);
}
// D
{
  const id = await run("D_UNVERIFIED_SUPPLIER");
  const s = await waitFor(id, (x) => ["BLOCKED", "FAILED", "PAID", "HUMAN_REVIEW"].includes(x.mission.status));
  const supplier = s.offers.find((o) => o.offerId === s.recommendation?.recommendedOfferId)?.supplierId;
  record("D unverified supplier", s.mission.status === "BLOCKED" && s.verification?.status === "REJECTED" && s.payments.length === 0, `AI picked ${supplier} · NASNES ${s.verification?.status} · 3ASES ${s.guardianDecision?.decision}`);
}
// E
{
  const id = await run("E_HUMAN_REVIEW");
  const s1 = await waitFor(id, (x) => ["HUMAN_REVIEW", "BLOCKED", "FAILED", "PAID"].includes(x.mission.status));
  // During review the only payment allowed is the one locked in the vault (SCHEDULED), never a live one.
  const okReview = s1.mission.status === "HUMAN_REVIEW" && s1.payments.every((p) => p.status === "SCHEDULED");
  const lockedOnLedger = s1.payments.some((p) => p.status === "SCHEDULED" && p.scheduleId);
  await call(`/api/missions/${id}/approvals`, "POST", { decision: "APPROVED", reason: "Need confirmed by field team (demo check)", actorId: cfg.operators[0], pin: process.env.DEMO_OPERATOR_PIN || "0619" });
  const s2 = await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "REJECTED", "FAILED"].includes(x.mission.status));
  record("E human review + vault", okReview && s2.mission.status === "PAID", `review stopped payment: ${okReview} · locked in vault: ${lockedOnLedger} (${s1.payments[0]?.scheduleId ?? "vault off"}) · after approval: ${s2.mission.status} via ${s2.payments[0]?.source ?? "?"}`);
  if (s2.payments[0]?.scheduleHashscanUrl) console.log(`      schedule: ${s2.payments[0].scheduleHashscanUrl}`);
}
// F
{
  const id = await run("F_TAMPERING");
  await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "FAILED"].includes(x.mission.status));
  const before = (await call<TrailVerification>(`/api/missions/${id}/verify`, "POST")).body;
  const t = await call<{ eventType: string; field: string; before: unknown; after: unknown; error?: string }>(`/api/missions/${id}/tamper`, "POST", { mode: "REWRITE_HASHES" });
  const after = (await call<TrailVerification>(`/api/missions/${id}/verify`, "POST")).body;
  record("F tampering detection", before.overall === "VALID" && after.overall === "TAMPERING_DETECTED", `before ${before.overall} · tamper ${t.body.eventType}.${t.body.field} ${JSON.stringify(t.body.before)}→${JSON.stringify(t.body.after)} · after ${after.overall}`);
}
// F' — deleted history (completeness against the ledger listing)
{
  const id = await run("F_TAMPERING");
  await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "FAILED"].includes(x.mission.status));
  const before = (await call<TrailVerification>(`/api/missions/${id}/verify`, "POST")).body;
  const t = await call<{ eventType: string }>(`/api/missions/${id}/tamper`, "POST", { mode: "DELETE_LAST_EVENT" });
  const after = (await call<TrailVerification>(`/api/missions/${id}/verify`, "POST")).body;
  record("F' deleted event detection", before.overall === "VALID" && after.overall === "TAMPERING_DETECTED" && after.missingLocalEvents.length === 1, `deleted ${t.body.eventType} · after ${after.overall} · missing locally: ${after.missingLocalEvents.map((m) => m.eventType).join(", ")}`);
}
// G
{
  const id = await run("G_RECYCLED_INVOICE");
  const s = await waitFor(id, (x) => ["BLOCKED", "FAILED", "PAID", "HUMAN_REVIEW"].includes(x.mission.status));
  const dup = s.verification?.checks.find((c) => c.id === "DUPLICATE_INVOICE");
  record("G recycled invoice", s.mission.status === "BLOCKED" && dup?.passed === false && s.payments.length === 0, `NASNES ${s.verification?.status} (${dup?.detail}) · 3ASES ${s.guardianDecision?.decision}`);
}

// H — ACME (second organization), inside its autonomous limit
let acmeMission = "";
{
  const id = await run("H_ACME_SUPPLIES");
  acmeMission = id;
  const s = await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "FAILED", "HUMAN_REVIEW"].includes(x.mission.status));
  record("H ACME office supplies", s.mission.status === "PAID" && (s.guardianDecision?.policyVersion ?? "").startsWith("1.0.0"), `${s.mission.status} · ACME policy ${s.guardianDecision?.policyVersion} · ${s.payments[0]?.settlementAmount ?? "-"} ${s.payments[0]?.settlementCurrency ?? ""}`);
}
// I — ACME above its limit → vault
{
  const id = await run("I_ACME_LAPTOPS");
  const s1 = await waitFor(id, (x) => ["HUMAN_REVIEW", "BLOCKED", "FAILED", "PAID"].includes(x.mission.status));
  await call(`/api/missions/${id}/approvals`, "POST", { decision: "APPROVED", reason: "Budget line ENG-2026 (demo check)", actorId: cfg.operators[0], pin: process.env.DEMO_OPERATOR_PIN || "0619" });
  const s2 = await waitFor(id, (x) => ["PAID", "PAYMENT_FAILED", "BLOCKED", "REJECTED", "FAILED"].includes(x.mission.status));
  record("I ACME laptops + vault", s1.mission.status === "HUMAN_REVIEW" && s2.mission.status === "PAID", `review: ${s1.mission.status} · after approval: ${s2.mission.status} via ${s2.payments[0]?.source ?? "?"}`);
}
// Public verifier: recompute everything here, against ledger copies read independently (Mirror Node when live)
{
  const bundle = (await call<ProofBundle>(`/api/public/missions/${acmeMission}/bundle`)).body;
  let copies: LedgerCopy[] = bundle.simulatedLedger ?? [];
  if (bundle.ledgerMode === "LIVE_TESTNET" && bundle.topicId) {
    copies = [];
    const since = (Date.parse(bundle.missionCreatedAt) / 1000 - 300).toFixed(9);
    let next: string | null = `/api/v1/topics/${bundle.topicId}/messages?limit=100&order=asc&timestamp=gte:${since}`;
    for (let page = 0; next && page < 30; page++) {
      const body = (await (await fetch(`${bundle.mirrorNodeUrl}${next}`)).json()) as { messages?: { message: string; sequence_number: number; consensus_timestamp: string }[]; links?: { next?: string | null } };
      for (const m of body.messages ?? []) copies.push({ sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp, message: Buffer.from(m.message, "base64").toString("utf8") });
      next = body.links?.next ?? null;
    }
  }
  const v = await verifyBundle(bundle, copies, async (t) => createHash("sha256").update(t, "utf8").digest("hex"));
  record("Public verifier (independent)", v.overall === "VALID", `${v.overall} · ${v.events.length} events recomputed · ledger chain ${v.ledgerChain.count} linked=${v.ledgerChain.linked}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
