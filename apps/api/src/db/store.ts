import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRun,
  AnchorInfo,
  Approval,
  AuditEvent,
  FeedMessage,
  GuardianDecision,
  Mission,
  MissionStatus,
  Offer,
  Payment,
  Recommendation,
  Supplier,
  TrailVerification,
  VerificationResult,
} from "@eljoker/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS missions (
  mission_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  scenario_id TEXT,
  created_at TEXT NOT NULL,
  missing_fields TEXT NOT NULL DEFAULT '[]',
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
  offer_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  invoice_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_mission ON offers(mission_id);
CREATE TABLE IF NOT EXISTS recommendations (
  mission_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_mission ON agent_runs(mission_id);
CREATE TABLE IF NOT EXISTS verifications (
  verification_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guardian_decisions (
  decision_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  approval_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL UNIQUE,          -- one human decision per mission
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,     -- the same payment can never be created twice
  invoice_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
-- At most one live (non-failed) payment per mission and per invoice, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_per_mission ON payments(mission_id) WHERE status <> 'FAILED';
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_per_invoice ON payments(invoice_id) WHERE status <> 'FAILED' AND invoice_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,               -- full off-chain evidence (canonical JSON)
  evidence_hash TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  anchor TEXT NOT NULL,
  UNIQUE(mission_id, sequence)
);
CREATE TABLE IF NOT EXISTS feed (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feed_mission ON feed(mission_id, seq);
CREATE TABLE IF NOT EXISTS trail_verifications (
  mission_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
-- SIMULATED ledger: only used when no Hedera credentials are configured. Clearly labeled in the UI.
CREATE TABLE IF NOT EXISTS simulated_ledger (
  sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  message TEXT NOT NULL,
  consensus_timestamp TEXT NOT NULL
);
-- SIMULATED vault schedules (same rule: only without Hedera credentials).
CREATE TABLE IF NOT EXISTS simulated_schedules (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);
-- A payment locked in the vault (SCHEDULED) still holds its slot; a cancelled one releases it like a failed one.
DROP INDEX IF EXISTS payments_one_live_per_mission;
DROP INDEX IF EXISTS payments_one_live_per_invoice;
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_mission ON payments(mission_id) WHERE status NOT IN ('FAILED', 'CANCELLED');
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_invoice ON payments(invoice_id) WHERE status NOT IN ('FAILED', 'CANCELLED') AND invoice_id IS NOT NULL;
`;

export interface SimulatedSchedule {
  to: string;
  amount: number;
  memo: string;
  signers: string[];
  executed: boolean;
  deleted: boolean;
  executedAt: string | null;
}

type Row = Record<string, unknown>;
const j = (v: unknown) => JSON.stringify(v);
const p = <T>(v: unknown): T => JSON.parse(String(v)) as T;

export class UniqueViolation extends Error {
  constructor(public readonly constraint: string, message: string) {
    super(message);
    this.name = "UniqueViolation";
  }
}

export class Store {
  readonly db: DatabaseSync;
  private feedSeq = 0;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM feed").get() as Row;
    this.feedSeq = Number(row.m);
  }

  private closed = false;

  /** Idempotent: closing twice is a no-op. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /* ---------------- missions ---------------- */
  insertMission(m: Mission, missingFields: string[] = []) {
    this.db
      .prepare("INSERT INTO missions (mission_id, status, scenario_id, created_at, missing_fields, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.missionId, m.status, m.scenarioId, m.createdAt, j(missingFields), j(m));
  }
  getMission(id: string): Mission | null {
    const r = this.db.prepare("SELECT data FROM missions WHERE mission_id = ?").get(id) as Row | undefined;
    return r ? p<Mission>(r.data) : null;
  }
  getMissingFields(id: string): string[] {
    const r = this.db.prepare("SELECT missing_fields FROM missions WHERE mission_id = ?").get(id) as Row | undefined;
    return r ? p<string[]>(r.missing_fields) : [];
  }
  setMissionStatus(id: string, status: MissionStatus) {
    const m = this.getMission(id);
    if (!m) throw new Error(`mission ${id} not found`);
    m.status = status;
    this.db.prepare("UPDATE missions SET status = ?, data = ? WHERE mission_id = ?").run(status, j(m), id);
  }
  listMissions(limit = 50): Mission[] {
    return (this.db.prepare("SELECT data FROM missions ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => p<Mission>(r.data));
  }

  /* ---------------- suppliers / offers ---------------- */
  upsertSupplier(s: Supplier) {
    this.db.prepare("INSERT INTO suppliers (supplier_id, data) VALUES (?, ?) ON CONFLICT(supplier_id) DO UPDATE SET data = excluded.data").run(s.supplierId, j(s));
  }
  getSupplier(id: string): Supplier | null {
    const r = this.db.prepare("SELECT data FROM suppliers WHERE supplier_id = ?").get(id) as Row | undefined;
    return r ? p<Supplier>(r.data) : null;
  }
  listSuppliers(): Supplier[] {
    return (this.db.prepare("SELECT data FROM suppliers ORDER BY supplier_id").all() as Row[]).map((r) => p<Supplier>(r.data));
  }
  insertOffer(o: Offer) {
    this.db.prepare("INSERT INTO offers (offer_id, mission_id, supplier_id, invoice_id, data) VALUES (?, ?, ?, ?, ?)").run(o.offerId, o.missionId, o.supplierId, o.invoiceId, j(o));
  }
  getOffer(id: string): Offer | null {
    const r = this.db.prepare("SELECT data FROM offers WHERE offer_id = ?").get(id) as Row | undefined;
    return r ? p<Offer>(r.data) : null;
  }
  listOffers(missionId: string): Offer[] {
    return (this.db.prepare("SELECT data FROM offers WHERE mission_id = ? ORDER BY rowid").all(missionId) as Row[]).map((r) => p<Offer>(r.data));
  }
  /** Other missions' offers that reuse the same invoice id (duplicate invoice detection). */
  findOffersByInvoice(invoiceId: string, excludeMissionId: string): Offer[] {
    return (this.db.prepare("SELECT data FROM offers WHERE invoice_id = ? AND mission_id <> ?").all(invoiceId, excludeMissionId) as Row[]).map((r) => p<Offer>(r.data));
  }

  /* ---------------- agent outputs ---------------- */
  saveRecommendation(missionId: string, r: Recommendation) {
    this.db.prepare("INSERT INTO recommendations (mission_id, data) VALUES (?, ?) ON CONFLICT(mission_id) DO UPDATE SET data = excluded.data").run(missionId, j(r));
  }
  getRecommendation(missionId: string): Recommendation | null {
    const r = this.db.prepare("SELECT data FROM recommendations WHERE mission_id = ?").get(missionId) as Row | undefined;
    return r ? p<Recommendation>(r.data) : null;
  }
  upsertAgentRun(run: AgentRun) {
    this.db.prepare("INSERT INTO agent_runs (run_id, mission_id, ts, data) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET data = excluded.data").run(run.runId, run.missionId, run.timestamp, j(run));
  }
  listAgentRuns(missionId: string): AgentRun[] {
    return (this.db.prepare("SELECT data FROM agent_runs WHERE mission_id = ? ORDER BY rowid").all(missionId) as Row[]).map((r) => p<AgentRun>(r.data));
  }
  insertVerification(v: VerificationResult) {
    this.db.prepare("INSERT INTO verifications (verification_id, mission_id, ts, data) VALUES (?, ?, ?, ?)").run(v.verificationId, v.missionId, v.verifiedAt, j(v));
  }
  latestVerification(missionId: string): VerificationResult | null {
    const r = this.db.prepare("SELECT data FROM verifications WHERE mission_id = ? ORDER BY rowid DESC LIMIT 1").get(missionId) as Row | undefined;
    return r ? p<VerificationResult>(r.data) : null;
  }
  insertGuardianDecision(d: GuardianDecision) {
    this.db.prepare("INSERT INTO guardian_decisions (decision_id, mission_id, ts, data) VALUES (?, ?, ?, ?)").run(d.decisionId, d.missionId, d.evaluatedAt, j(d));
  }
  latestGuardianDecision(missionId: string): GuardianDecision | null {
    const r = this.db.prepare("SELECT data FROM guardian_decisions WHERE mission_id = ? ORDER BY rowid DESC LIMIT 1").get(missionId) as Row | undefined;
    return r ? p<GuardianDecision>(r.data) : null;
  }

  /* ---------------- approvals ---------------- */
  insertApproval(a: Approval) {
    try {
      this.db.prepare("INSERT INTO approvals (approval_id, mission_id, data) VALUES (?, ?, ?)").run(a.approvalId, a.missionId, j(a));
    } catch (e) {
      throw this.mapUnique(e, "approvals.mission_id", "A human decision was already recorded for this mission");
    }
  }
  getApproval(missionId: string): Approval | null {
    const r = this.db.prepare("SELECT data FROM approvals WHERE mission_id = ?").get(missionId) as Row | undefined;
    return r ? p<Approval>(r.data) : null;
  }

  /* ---------------- payments ---------------- */
  insertPayment(pm: Payment) {
    try {
      this.db
        .prepare("INSERT INTO payments (payment_id, mission_id, idempotency_key, invoice_id, status, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(pm.paymentId, pm.missionId, pm.idempotencyKey, pm.invoiceId, pm.status, pm.createdAt, j(pm));
    } catch (e) {
      throw this.mapUnique(e, "payments", "Duplicate payment rejected by database constraint");
    }
  }
  updatePayment(pm: Payment) {
    this.db.prepare("UPDATE payments SET status = ?, data = ? WHERE payment_id = ?").run(pm.status, j(pm), pm.paymentId);
  }
  listPayments(missionId: string): Payment[] {
    return (this.db.prepare("SELECT data FROM payments WHERE mission_id = ? ORDER BY created_at").all(missionId) as Row[]).map((r) => p<Payment>(r.data));
  }
  findPaymentByIdempotencyKey(key: string): Payment | null {
    const r = this.db.prepare("SELECT data FROM payments WHERE idempotency_key = ?").get(key) as Row | undefined;
    return r ? p<Payment>(r.data) : null;
  }
  /** A payment holding this invoice: committed, moved, or locked in the vault (not failed or cancelled). */
  findLivePaymentByInvoice(invoiceId: string): Payment | null {
    const r = this.db.prepare("SELECT data FROM payments WHERE invoice_id = ? AND status NOT IN ('FAILED', 'CANCELLED') LIMIT 1").get(invoiceId) as Row | undefined;
    return r ? p<Payment>(r.data) : null;
  }
  /** Remove a reservation that never reached the ledger (vault lock failed): nothing was committed, nothing to keep. */
  deleteUncommittedPayment(paymentId: string) {
    this.db.prepare("DELETE FROM payments WHERE payment_id = ? AND status = 'SCHEDULED'").run(paymentId);
  }
  /** The payment locked in the vault for this mission, if any. */
  findScheduledPayment(missionId: string): Payment | null {
    const r = this.db.prepare("SELECT data FROM payments WHERE mission_id = ? AND status = 'SCHEDULED' LIMIT 1").get(missionId) as Row | undefined;
    return r ? p<Payment>(r.data) : null;
  }

  /* ---------------- audit events ---------------- */
  insertAuditEvent(e: AuditEvent, payloadJson: string) {
    const { payload: _payload, anchor, ...rest } = e;
    this.db
      .prepare(
        "INSERT INTO audit_events (event_id, mission_id, sequence, event_type, payload_json, evidence_hash, previous_event_hash, event_hash, data, anchor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(e.eventId, e.missionId, e.sequence, e.eventType, payloadJson, e.evidenceHash, e.previousEventHash, e.eventHash, j(rest), j(anchor));
  }
  updateAnchor(eventId: string, anchor: AnchorInfo) {
    this.db.prepare("UPDATE audit_events SET anchor = ? WHERE event_id = ?").run(j(anchor), eventId);
  }
  private rowToEvent(r: Row): AuditEvent {
    const rest = p<Omit<AuditEvent, "payload" | "anchor">>(r.data);
    return {
      ...rest,
      // Columns are the source of truth for what verification reads.
      evidenceHash: String(r.evidence_hash),
      previousEventHash: String(r.previous_event_hash),
      eventHash: String(r.event_hash),
      payload: p<Record<string, unknown>>(r.payload_json),
      anchor: p<AnchorInfo>(r.anchor),
    };
  }
  listAuditEvents(missionId: string): AuditEvent[] {
    return (this.db.prepare("SELECT * FROM audit_events WHERE mission_id = ? ORDER BY sequence").all(missionId) as Row[]).map((r) => this.rowToEvent(r));
  }
  getAuditEvent(eventId: string): AuditEvent | null {
    const r = this.db.prepare("SELECT * FROM audit_events WHERE event_id = ?").get(eventId) as Row | undefined;
    return r ? this.rowToEvent(r) : null;
  }
  /** Raw payload text as stored (used by the verifier, which must hash what is actually on disk). */
  getRawPayload(eventId: string): string | null {
    const r = this.db.prepare("SELECT payload_json FROM audit_events WHERE event_id = ?").get(eventId) as Row | undefined;
    return r ? String(r.payload_json) : null;
  }
  /** DEMO-ONLY: overwrite the stored evidence of a historical event without touching its hashes. */
  tamperPayload(eventId: string, payloadJson: string) {
    this.db.prepare("UPDATE audit_events SET payload_json = ? WHERE event_id = ?").run(payloadJson, eventId);
  }

  /** DEMO-ONLY: an insider who also recomputes the local hash chain (the attack a plain database cannot detect). */
  rewriteEventHashes(eventId: string, evidenceHash: string, previousEventHash: string, eventHash: string) {
    this.db.prepare("UPDATE audit_events SET evidence_hash = ?, previous_event_hash = ?, event_hash = ? WHERE event_id = ?").run(evidenceHash, previousEventHash, eventHash, eventId);
  }

  /* ---------------- feed ---------------- */
  insertFeed(f: FeedMessage) {
    this.feedSeq += 1;
    this.db.prepare("INSERT INTO feed (id, mission_id, created_at, seq, data) VALUES (?, ?, ?, ?, ?)").run(f.id, f.missionId, f.createdAt, this.feedSeq, j(f));
  }
  listFeed(missionId: string): FeedMessage[] {
    return (this.db.prepare("SELECT data FROM feed WHERE mission_id = ? ORDER BY seq").all(missionId) as Row[]).map((r) => p<FeedMessage>(r.data));
  }

  /* ---------------- verification reports ---------------- */
  saveTrailVerification(v: TrailVerification) {
    this.db.prepare("INSERT INTO trail_verifications (mission_id, data) VALUES (?, ?) ON CONFLICT(mission_id) DO UPDATE SET data = excluded.data").run(v.missionId, j(v));
  }
  getTrailVerification(missionId: string): TrailVerification | null {
    const r = this.db.prepare("SELECT data FROM trail_verifications WHERE mission_id = ?").get(missionId) as Row | undefined;
    return r ? p<TrailVerification>(r.data) : null;
  }

  /* ---------------- simulated ledger ---------------- */
  appendSimulatedMessage(topicId: string, message: string): { sequenceNumber: number; consensusTimestamp: string } {
    const consensusTimestamp = new Date().toISOString();
    const res = this.db.prepare("INSERT INTO simulated_ledger (topic_id, message, consensus_timestamp) VALUES (?, ?, ?)").run(topicId, message, consensusTimestamp);
    return { sequenceNumber: Number(res.lastInsertRowid), consensusTimestamp };
  }
  getSimulatedMessage(sequenceNumber: number): { message: string; consensusTimestamp: string; topicId: string } | null {
    const r = this.db.prepare("SELECT * FROM simulated_ledger WHERE sequence_number = ?").get(sequenceNumber) as Row | undefined;
    return r ? { message: String(r.message), consensusTimestamp: String(r.consensus_timestamp), topicId: String(r.topic_id) } : null;
  }

  listSimulatedMessages(sinceIso: string | null): { sequenceNumber: number; message: string; consensusTimestamp: string; topicId: string }[] {
    const rows = (sinceIso
      ? this.db.prepare("SELECT * FROM simulated_ledger WHERE consensus_timestamp >= ? ORDER BY sequence_number").all(sinceIso)
      : this.db.prepare("SELECT * FROM simulated_ledger ORDER BY sequence_number").all()) as Row[];
    return rows.map((r) => ({ sequenceNumber: Number(r.sequence_number), message: String(r.message), consensusTimestamp: String(r.consensus_timestamp), topicId: String(r.topic_id) }));
  }

  createSimulatedSchedule(s: SimulatedSchedule): string {
    const row = this.db.prepare("SELECT COALESCE(MAX(n), 0) + 1 AS next FROM simulated_schedules").get() as Row;
    const scheduleId = `SIM-SCHEDULE-${Number(row.next)}`;
    this.db.prepare("INSERT INTO simulated_schedules (schedule_id, data) VALUES (?, ?)").run(scheduleId, j(s));
    return scheduleId;
  }
  getSimulatedSchedule(scheduleId: string): SimulatedSchedule | null {
    const r = this.db.prepare("SELECT data FROM simulated_schedules WHERE schedule_id = ?").get(scheduleId) as Row | undefined;
    return r ? p<SimulatedSchedule>(r.data) : null;
  }
  updateSimulatedSchedule(scheduleId: string, s: SimulatedSchedule) {
    this.db.prepare("UPDATE simulated_schedules SET data = ? WHERE schedule_id = ?").run(j(s), scheduleId);
  }

  /** DEMO-ONLY: an insider deletes a historical event from the local database. */
  deleteAuditEvent(eventId: string) {
    this.db.prepare("DELETE FROM audit_events WHERE event_id = ?").run(eventId);
  }

  /** Demo history: an offer from an earlier (fictional) mission, so a recycled invoice can be detected. */
  upsertHistoricalOffer(o: Offer) {
    this.db.prepare("INSERT INTO offers (offer_id, mission_id, supplier_id, invoice_id, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(offer_id) DO NOTHING").run(o.offerId, o.missionId, o.supplierId, o.invoiceId, j(o));
  }

  /** DEMO-ONLY reset of all mission data (suppliers are re-seeded by the caller). */
  resetAll() {
    this.db.exec(
      "DELETE FROM missions; DELETE FROM offers; DELETE FROM recommendations; DELETE FROM agent_runs; DELETE FROM verifications; DELETE FROM guardian_decisions; DELETE FROM approvals; DELETE FROM payments; DELETE FROM audit_events; DELETE FROM feed; DELETE FROM trail_verifications;",
    );
  }

  private mapUnique(e: unknown, constraint: string, message: string): Error {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed/i.test(msg)) return new UniqueViolation(constraint, `${message} (${msg})`);
    return e instanceof Error ? e : new Error(msg);
  }
}
