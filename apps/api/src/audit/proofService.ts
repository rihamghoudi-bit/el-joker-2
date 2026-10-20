import { type AgentName, type AnchorInfo, type AuditEvent, type AuditEventType, type EventHeader, type EventVerification, GENESIS_HASH, LEDGER_PROTOCOL, type LedgerRecord, type MissingLocalEvent, parseLedgerRecord, type TrailVerification } from "@eljoker/shared";
import type { Store } from "../db/store";
import type { LedgerGateway, LedgerMessage } from "../hedera/gateway";
import { canonicalize, hashCanonical, newId, nowIso, sha256Hex, sleep } from "../lib/canonical";
import { logger } from "../logger";

export const AUDIT_SCHEMA_VERSION = "eljoker.audit/1";
export { GENESIS_HASH };
export type { EventHeader, LedgerRecord };

/** eventHash commits to the header, which commits to the evidence hash and the previous event: a hash chain. */
export function computeEventHash(h: EventHeader): string {
  return hashCanonical(h);
}

export function buildLedgerMessage(e: Pick<AuditEvent, "missionId" | "eventId" | "eventType" | "sequence" | "evidenceHash" | "previousEventHash" | "eventHash" | "policyVersion" | "timestamp">): string {
  const rec: LedgerRecord = {
    p: LEDGER_PROTOCOL,
    v: "1",
    m: e.missionId,
    e: e.eventId,
    t: e.eventType,
    s: e.sequence,
    h: e.evidenceHash,
    ph: e.previousEventHash,
    eh: e.eventHash,
    pv: e.policyVersion,
    ts: e.timestamp,
  };
  return canonicalize(rec);
}

export const parseLedgerMessage = parseLedgerRecord;

export interface RecordEventInput {
  missionId: string;
  eventType: AuditEventType;
  agent: AgentName;
  summary: string;
  payload: Record<string, unknown>;
}

export type TamperMode = "EDIT_EVIDENCE" | "REWRITE_HASHES" | "DELETE_LAST_EVENT";

/**
 * HederaProofService: builds the hash-linked audit chain locally and anchors every event to HCS.
 * recordEvent() / getProof() / verifyProof() / verifyMissionTrail()
 */
export class ProofService {
  private queues = new Map<string, Promise<void>>();
  private anchorWaiters = new Map<string, ((a: AnchorInfo) => void)[]>();

  constructor(
    private readonly store: Store,
    private readonly ledger: LedgerGateway,
    /** Policy version in force for a mission (each organization has its own policy). */
    private readonly policyVersion: (missionId: string) => string,
    private readonly opts: { retryDelayMs?: number; mirrorAttempts?: number; mirrorDelayMs?: number } = {},
  ) {}

  get mode() {
    return this.ledger.mode;
  }

  /** Synchronously appends the event to the local chain, then queues HCS anchoring (ordered per mission). */
  recordEvent(input: RecordEventInput): AuditEvent {
    const event = this.store.transaction(() => {
      const existing = this.store.listAuditEvents(input.missionId);
      const prev = existing[existing.length - 1];
      const payloadJson = canonicalize(input.payload);
      const header: EventHeader = {
        schemaVersion: AUDIT_SCHEMA_VERSION,
        eventId: newId("evt"),
        missionId: input.missionId,
        sequence: existing.length,
        eventType: input.eventType,
        agent: input.agent,
        policyVersion: this.policyVersion(input.missionId),
        timestamp: nowIso(),
        evidenceHash: sha256Hex(payloadJson),
        previousEventHash: prev ? prev.eventHash : GENESIS_HASH,
      };
      const ev: AuditEvent = {
        ...header,
        summary: input.summary,
        payload: input.payload,
        eventHash: computeEventHash(header),
        anchor: { status: "PENDING", network: this.ledger.mode === "LIVE_TESTNET" ? "testnet" : "simulated", topicId: this.ledger.topicId, sequenceNumber: null, transactionId: null, consensusTimestamp: null, hashscanUrl: null, error: null },
      };
      this.store.insertAuditEvent(ev, payloadJson);
      return ev;
    });
    const prevQueue = this.queues.get(input.missionId) ?? Promise.resolve();
    const next = prevQueue.then(() => this.anchor(event)).catch(() => undefined);
    this.queues.set(input.missionId, next);
    return event;
  }

  /** Resolves when every queued anchor for the mission has settled. */
  async idle(missionId: string): Promise<void> {
    await (this.queues.get(missionId) ?? Promise.resolve());
  }

  private async anchor(event: AuditEvent): Promise<void> {
    const message = buildLedgerMessage(event);
    let anchor: AnchorInfo = { ...event.anchor };
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await this.ledger.submitMessage(message);
        anchor = {
          ...anchor,
          status: this.ledger.mode === "LIVE_TESTNET" ? "ANCHORED" : "SIMULATED",
          topicId: res.topicId,
          sequenceNumber: res.sequenceNumber,
          transactionId: res.transactionId,
          consensusTimestamp: res.consensusTimestamp,
          hashscanUrl: this.ledger.hashscanTransactionUrl(res.transactionId, null),
          error: null,
        };
        logger.info("proof.anchored", { eventType: event.eventType, missionId: event.missionId, seq: res.sequenceNumber, tx: res.transactionId });
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("proof.anchor_failed", { eventType: event.eventType, attempt, error: msg });
        anchor = { ...anchor, status: "FAILED", error: `HCS submit failed: ${msg}` };
        if (attempt === 1) await sleep(this.opts.retryDelayMs ?? 1500);
      }
    }
    this.store.updateAnchor(event.eventId, anchor);
    for (const w of this.anchorWaiters.get(event.eventId) ?? []) w(anchor);
    this.anchorWaiters.delete(event.eventId);
  }

  /** Wait until an event is anchored (or failed). Used by KANAWITA: no authorization proof, no payment. */
  async waitForAnchor(eventId: string, timeoutMs = 45_000): Promise<AnchorInfo> {
    const current = this.store.getAuditEvent(eventId);
    if (!current) throw new Error(`event ${eventId} not found`);
    if (current.anchor.status !== "PENDING") return current.anchor;
    return new Promise<AnchorInfo>((resolve) => {
      const timer = setTimeout(() => resolve({ ...current.anchor, status: "PENDING", error: "Timed out waiting for Hedera consensus" }), timeoutMs);
      const list = this.anchorWaiters.get(eventId) ?? [];
      list.push((a) => {
        clearTimeout(timer);
        resolve(a);
      });
      this.anchorWaiters.set(eventId, list);
    });
  }

  getProof(eventId: string): { event: AuditEvent; ledgerMessage: string } | null {
    const event = this.store.getAuditEvent(eventId);
    return event ? { event, ledgerMessage: buildLedgerMessage(event) } : null;
  }

  private async fetchLedger(seq: number): Promise<{ msg: LedgerMessage | null; error: string | null }> {
    const attempts = this.ledger.mode === "LIVE_TESTNET" ? (this.opts.mirrorAttempts ?? 6) : 1;
    let lastErr: string | null = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const msg = await this.ledger.fetchTopicMessage(seq);
        if (msg) return { msg, error: null };
        lastErr = null;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
      if (i < attempts - 1) await sleep(this.opts.mirrorDelayMs ?? 2000);
    }
    return { msg: null, error: lastErr };
  }

  /**
   * Verify one event: local integrity + chain link + independent ledger read-back.
   * `hint` is the ledger message found for this eventId in the topic listing (preferred over the local anchor metadata,
   * which an insider could also edit).
   */
  async verifyProof(event: AuditEvent, expectedPrevious: string, hint: LedgerMessage | null = null): Promise<EventVerification> {
    const raw = this.store.getRawPayload(event.eventId) ?? "{}";
    let recomputedEvidenceHash: string;
    try {
      recomputedEvidenceHash = hashCanonical(JSON.parse(raw));
    } catch {
      recomputedEvidenceHash = sha256Hex(raw);
    }
    const header: EventHeader = {
      schemaVersion: event.schemaVersion,
      eventId: event.eventId,
      missionId: event.missionId,
      sequence: event.sequence,
      eventType: event.eventType,
      agent: event.agent,
      policyVersion: event.policyVersion,
      timestamp: event.timestamp,
      evidenceHash: recomputedEvidenceHash,
      previousEventHash: event.previousEventHash,
    };
    const recomputedEventHash = computeEventHash(header);
    const problems: string[] = [];
    const evidenceHashIntact = recomputedEvidenceHash === event.evidenceHash;
    const eventHashIntact = recomputedEventHash === event.eventHash;
    const chainLinkValid = event.previousEventHash === expectedPrevious;
    if (!evidenceHashIntact) problems.push("Local evidence no longer matches its stored hash");
    if (!eventHashIntact) problems.push("Event header hash mismatch");
    if (!chainLinkValid) problems.push("Hash chain broken (previousEventHash does not match prior event)");

    const local = {
      storedEvidenceHash: event.evidenceHash,
      recomputedEvidenceHash,
      storedEventHash: event.eventHash,
      recomputedEventHash,
      previousEventHash: event.previousEventHash,
    };

    let ledgerView: EventVerification["ledger"] = null;
    let matchesLedger: boolean | null = null;
    let status: EventVerification["status"];

    let msg = hint;
    let error: string | null = null;
    if (!msg && event.anchor.sequenceNumber != null) ({ msg, error } = await this.fetchLedger(event.anchor.sequenceNumber));
    const rec = msg ? parseLedgerMessage(msg.message) : null;

    if (!msg || !rec) {
      if (event.anchor.sequenceNumber == null) {
        status = event.anchor.status === "PENDING" ? "PENDING" : "MISSING_PROOF";
        problems.push(event.anchor.status === "PENDING" ? "Awaiting Hedera consensus" : `No ledger proof (${event.anchor.error ?? "anchor failed"})`);
      } else {
        status = "PENDING";
        problems.push(error ? `Mirror Node error: ${error}` : "Proof not yet visible on the Mirror Node");
      }
    } else {
      ledgerView = {
        source: msg.source,
        evidenceHash: rec.h,
        eventHash: rec.eh,
        previousEventHash: rec.ph,
        consensusTimestamp: msg.consensusTimestamp,
        sequenceNumber: msg.sequenceNumber,
        topicId: msg.topicId,
        hashscanUrl: this.ledger.hashscanTransactionUrl(event.anchor.transactionId, msg.source === "MIRROR_NODE" ? msg.consensusTimestamp : null),
      };
      // Compare what is on disk NOW against what consensus recorded THEN.
      matchesLedger = rec.e === event.eventId && rec.h === recomputedEvidenceHash && rec.eh === recomputedEventHash && rec.ph === event.previousEventHash;
      if (!matchesLedger) problems.push("Local record does not match the Hedera proof");
      // The local anchor metadata must point at the same consensus message.
      const anchorMetaOk = event.anchor.sequenceNumber == null || event.anchor.sequenceNumber === msg.sequenceNumber;
      if (!anchorMetaOk) problems.push(`Local anchor metadata altered (says #${event.anchor.sequenceNumber}, ledger has #${msg.sequenceNumber})`);
      // Backfill missing anchor metadata (sequence number, consensus timestamp) from the ledger.
      if (anchorMetaOk && (event.anchor.sequenceNumber == null || (msg.source === "MIRROR_NODE" && msg.consensusTimestamp && !event.anchor.consensusTimestamp))) {
        this.store.updateAnchor(event.eventId, {
          ...event.anchor,
          status: msg.source === "MIRROR_NODE" ? "ANCHORED" : "SIMULATED",
          sequenceNumber: msg.sequenceNumber,
          topicId: msg.topicId,
          consensusTimestamp: msg.consensusTimestamp,
          hashscanUrl: ledgerView.hashscanUrl,
          error: null,
        });
      }
      const allGood = evidenceHashIntact && eventHashIntact && chainLinkValid && matchesLedger && anchorMetaOk;
      status = allGood ? (msg.source === "SIMULATED_LEDGER" ? "SIMULATED_VALID" : "VALID") : "TAMPERED";
    }
    if (status !== "TAMPERED" && (!evidenceHashIntact || !eventHashIntact || !chainLinkValid)) status = "TAMPERED";

    return { eventId: event.eventId, eventType: event.eventType, sequence: event.sequence, status, local, ledger: ledgerView, checks: { evidenceHashIntact, eventHashIntact, chainLinkValid, matchesLedger }, problems };
  }

  /**
   * Every proof the ledger holds for this mission, grouped by eventId. One event can legitimately appear more than
   * once: when a receipt times out after the message already reached consensus, the retry publishes an identical copy.
   */
  private async ledgerRecordsFor(missionId: string, sinceIso: string | null): Promise<Map<string, { msg: LedgerMessage; rec: LedgerRecord }[]>> {
    const out = new Map<string, { msg: LedgerMessage; rec: LedgerRecord }[]>();
    for (const msg of await this.ledger.listTopicMessages(sinceIso)) {
      const rec = parseLedgerMessage(msg.message);
      if (!rec || rec.m !== missionId) continue;
      const list = out.get(rec.e) ?? [];
      list.push({ msg, rec });
      out.set(rec.e, list);
    }
    return out;
  }

  /** The copy the local anchor points at (if it exists on the ledger), else the first one. */
  private pickLedgerCopy(copies: { msg: LedgerMessage; rec: LedgerRecord }[] | undefined, localSeq: number | null): LedgerMessage | null {
    if (!copies?.length) return null;
    return (copies.find((c) => c.msg.sequenceNumber === localSeq) ?? copies.at(0)!).msg;
  }

  /**
   * Verify the whole mission trail against the ledger:
   *  - each local event (integrity, chain link, matching consensus proof)
   *  - completeness: every proof the ledger holds for this mission must still exist locally (detects deleted history)
   */
  async verifyMissionTrail(missionId: string): Promise<TrailVerification> {
    await this.idle(missionId);
    const mission = this.store.getMission(missionId);
    const events = this.store.listAuditEvents(missionId);
    const since = mission ? new Date(Date.parse(mission.createdAt) - 5 * 60_000).toISOString() : null;
    const live = this.ledger.mode === "LIVE_TESTNET";

    // List the mission's proofs from the ledger. On testnet the Mirror Node may lag a few seconds: retry until
    // every locally-anchored event is visible (or attempts run out; per-event lookup then falls back to the sequence number).
    let byEvent = new Map<string, { msg: LedgerMessage; rec: LedgerRecord }[]>();
    let ledgerEventCount: number | null = null;
    const attempts = live ? (this.opts.mirrorAttempts ?? 6) : 1;
    for (let i = 0; i < attempts; i++) {
      try {
        byEvent = await this.ledgerRecordsFor(missionId, since);
        ledgerEventCount = byEvent.size;
        if (!events.some((e) => e.anchor.sequenceNumber != null && !byEvent.has(e.eventId))) break;
      } catch (e) {
        logger.warn("proof.listing_failed", { missionId, error: e });
        ledgerEventCount = null;
      }
      if (i < attempts - 1) await sleep(this.opts.mirrorDelayMs ?? 2000);
    }

    const results: EventVerification[] = [];
    let expectedPrev = GENESIS_HASH;
    for (const ev of events) {
      results.push(await this.verifyProof(ev, expectedPrev, this.pickLedgerCopy(byEvent.get(ev.eventId), ev.anchor.sequenceNumber)));
      expectedPrev = ev.eventHash;
    }

    const localIds = new Set(events.map((e) => e.eventId));
    const missingLocalEvents: MissingLocalEvent[] = [...byEvent.values()]
      .map((copies) => copies.at(0)!)
      .filter(({ rec }) => !localIds.has(rec.e))
      .map(({ msg, rec }) => ({
        eventId: rec.e,
        eventType: rec.t,
        sequence: typeof rec.s === "number" ? rec.s : null,
        ledgerSequenceNumber: msg.sequenceNumber,
        consensusTimestamp: msg.consensusTimestamp,
        hashscanUrl: msg.source === "MIRROR_NODE" ? this.ledger.hashscanTransactionUrl(null, msg.consensusTimestamp) : null,
      }));

    const tampered = results.filter((r) => r.status === "TAMPERED");
    const pending = results.filter((r) => r.status === "PENDING");
    const missing = results.filter((r) => r.status === "MISSING_PROOF");
    const overall: TrailVerification["overall"] = tampered.length || missingLocalEvents.length ? "TAMPERING_DETECTED" : pending.length ? "PENDING" : missing.length ? "UNVERIFIABLE" : "VALID";
    const src = live ? "Hedera testnet (Mirror Node)" : "SIMULATED ledger";
    const parts: string[] = [];
    if (tampered.length) parts.push(`${tampered.length} event(s) no longer match the proof recorded on ${src}: ${tampered.map((t) => t.eventType).join(", ")}`);
    if (missingLocalEvents.length) parts.push(`${missingLocalEvents.length} event(s) proven on ${src} were deleted locally: ${missingLocalEvents.map((m) => m.eventType).join(", ")}`);
    const summary =
      overall === "TAMPERING_DETECTED"
        ? parts.join(" · ")
        : overall === "PENDING"
          ? `${pending.length} event(s) still waiting for consensus / Mirror Node indexing`
          : overall === "UNVERIFIABLE"
            ? `${missing.length} event(s) have no ledger proof`
            : `All ${results.length} events match their proofs on ${src}, and no proven event is missing locally`;
    const report: TrailVerification = { missionId, verifiedAt: nowIso(), overall, ledgerMode: this.ledger.mode, events: results, missingLocalEvents, ledgerEventCount, summary };
    this.store.saveTrailVerification(report);
    return report;
  }

  /**
   * DEMO/DEVELOPMENT ONLY. Simulates an insider editing historical evidence in the local database.
   * EDIT_EVIDENCE: payload changed, hashes untouched (local check catches it).
   * REWRITE_HASHES: payload changed AND the local hash chain recomputed (only Hedera catches it).
   * DELETE_LAST_EVENT: the latest event is erased; the remaining chain stays consistent (only the ledger listing catches it).
   */
  tamper(missionId: string, mode: TamperMode): { eventId: string; eventType: AuditEventType; field: string; before: unknown; after: unknown } {
    const events = this.store.listAuditEvents(missionId);
    if (mode === "DELETE_LAST_EVENT") {
      // Erase the most recent decision (e.g. the payment record or a blocked attempt) to rewrite what "happened".
      const last = [...events].reverse().find((e) => e.eventType !== "TAMPER_DETECTED");
      if (!last) throw new Error("No event available to delete");
      this.store.deleteAuditEvent(last.eventId);
      logger.warn("demo.tamper_applied", { missionId, eventType: last.eventType, mode });
      return { eventId: last.eventId, eventType: last.eventType, field: "(entire event)", before: last.eventType, after: "deleted" };
    }
    const preferred: AuditEventType[] = ["GUARDIAN_APPROVED", "PAYMENT_CONFIRMED", "AI_RECOMMENDATION", "GUARDIAN_BLOCKED", "MISSION_CREATED"];
    const target = preferred.map((t) => events.find((e) => e.eventType === t)).find(Boolean);
    if (!target) throw new Error("No event available to tamper with");
    const payload = JSON.parse(this.store.getRawPayload(target.eventId) ?? "{}") as Record<string, unknown>;
    let field: string;
    let before: unknown;
    let after: unknown;
    const offer = payload.offer as Record<string, unknown> | undefined;
    if (offer && typeof offer.totalPrice === "number") {
      field = "offer.totalPrice";
      before = offer.totalPrice;
      after = Math.round(offer.totalPrice * 1.6);
      offer.totalPrice = after;
    } else if (typeof payload.maximumBudget === "number") {
      field = "maximumBudget";
      before = payload.maximumBudget;
      after = payload.maximumBudget * 10;
      payload.maximumBudget = after;
    } else {
      field = "summary";
      before = payload.summary ?? null;
      after = "Edited after the fact";
      payload.summary = after;
    }
    const payloadJson = canonicalize(payload);
    this.store.tamperPayload(target.eventId, payloadJson);

    if (mode === "REWRITE_HASHES") {
      // Recompute this event's hashes and re-link every later event so the LOCAL chain is self-consistent.
      let prevHash = target.previousEventHash;
      for (const ev of events.filter((e) => e.sequence >= target.sequence)) {
        const raw = this.store.getRawPayload(ev.eventId) ?? "{}";
        const evidenceHash = hashCanonical(JSON.parse(raw));
        const header: EventHeader = { schemaVersion: ev.schemaVersion, eventId: ev.eventId, missionId: ev.missionId, sequence: ev.sequence, eventType: ev.eventType, agent: ev.agent, policyVersion: ev.policyVersion, timestamp: ev.timestamp, evidenceHash, previousEventHash: prevHash };
        const eventHash = computeEventHash(header);
        this.store.rewriteEventHashes(ev.eventId, evidenceHash, prevHash, eventHash);
        prevHash = eventHash;
      }
    }
    logger.warn("demo.tamper_applied", { missionId, eventType: target.eventType, field, mode });
    return { eventId: target.eventId, eventType: target.eventType, field, before, after };
  }
}
