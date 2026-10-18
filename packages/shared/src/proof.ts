/**
 * Proof format and an independent verifier that runs anywhere (Node or the browser).
 *
 * The public verifier page uses `verifyBundle` with the browser's own SHA-256 and with ledger messages it read
 * itself from the Hedera Mirror Node: it never has to trust the EL JOKER server.
 */
import type { AgentName, AuditEventType, LedgerMode, OrganizationId, PaymentSource, PaymentStatus } from "./domain";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, arrays keep order.
 * Equivalent input objects always produce byte-identical output, so their SHA-256 is stable.
 * Rejects values that JSON cannot represent faithfully (undefined in arrays, NaN, Infinity, functions).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => {
          if (v === undefined) throw new Error("canonicalize: undefined in array");
          return canonicalize(v);
        }).join(",") + "]";
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

export const GENESIS_HASH = "0".repeat(64);
export const LEDGER_PROTOCOL = "eljoker";

/** Minimal on-chain record. No beneficiary data, no documents, no prices — only identifiers and hashes. */
export interface LedgerRecord {
  p: string;
  v: string;
  m: string;
  e: string;
  t: AuditEventType;
  s: number;
  h: string;
  ph: string;
  eh: string;
  pv: string;
  ts: string;
}

export function parseLedgerRecord(raw: string): LedgerRecord | null {
  try {
    const obj = JSON.parse(raw) as Partial<LedgerRecord>;
    if (obj.p !== LEDGER_PROTOCOL || typeof obj.h !== "string" || typeof obj.eh !== "string" || typeof obj.e !== "string") return null;
    return obj as LedgerRecord;
  } catch {
    return null;
  }
}

/** The fields an event hash commits to (it commits to the evidence hash and to the previous event: a hash chain). */
export interface EventHeader {
  schemaVersion: string;
  eventId: string;
  missionId: string;
  sequence: number;
  eventType: AuditEventType;
  agent: AgentName;
  policyVersion: string;
  timestamp: string;
  evidenceHash: string;
  previousEventHash: string;
}

/* ------------------------------------------------------------------ */
/* Public proof bundle                                                 */
/* ------------------------------------------------------------------ */

export interface ProofBundleEvent extends EventHeader {
  summary: string;
  eventHash: string;
  /** The full off-chain evidence exactly as stored (canonical JSON text). */
  payloadJson: string;
  anchor: { status: string; sequenceNumber: number | null; transactionId: string | null; consensusTimestamp: string | null };
}

export interface ProofBundlePayment {
  paymentId: string;
  status: PaymentStatus;
  source: PaymentSource;
  amount: number;
  settlementAmount: number;
  settlementCurrency: string;
  settlementTokenId: string | null;
  payeeAccountId: string | null;
  vaultAccountId: string | null;
  hederaTransactionId: string | null;
  scheduleId: string | null;
}

/** Everything the EL JOKER server claims about a mission. The verifier treats it as untrusted input. */
export interface ProofBundle {
  missionId: string;
  organizationId: OrganizationId;
  description: string;
  missionStatus: string;
  missionCreatedAt: string;
  generatedAt: string;
  ledgerMode: LedgerMode;
  topicId: string | null;
  mirrorNodeUrl: string;
  events: ProofBundleEvent[];
  payments: ProofBundlePayment[];
  /** SIMULATED mode only: the stand-in ledger's copies (not independent; labeled as such in the UI). */
  simulatedLedger: LedgerCopy[] | null;
}

export interface LedgerCopy {
  sequenceNumber: number;
  consensusTimestamp: string | null;
  /** Decoded UTF-8 message body as published. */
  message: string;
}

export interface BundleEventResult {
  eventId: string;
  eventType: AuditEventType;
  sequence: number;
  status: "VALID" | "TAMPERED" | "NOT_ON_LEDGER";
  ledgerSequenceNumber: number | null;
  consensusTimestamp: string | null;
  checks: {
    /** SHA-256 of the evidence recomputed here equals the hash the event claims. */
    evidenceHash: boolean;
    /** The event hash recomputed here from its header equals the hash the event claims. */
    eventHash: boolean;
    /** previousEventHash points at the event before it. */
    chainLink: boolean;
    /** The consensus record on the ledger holds exactly these hashes. */
    matchesLedger: boolean | null;
  };
  problems: string[];
}

export interface BundleVerification {
  overall: "VALID" | "TAMPERING_DETECTED" | "INCOMPLETE";
  events: BundleEventResult[];
  /** Proofs the ledger holds for this mission that the bundle no longer contains (deleted history). */
  missingFromBundle: { eventId: string; eventType: string; sequence: number | null; ledgerSequenceNumber: number; consensusTimestamp: string | null }[];
  /** Checked from the ledger alone: the mission's proofs are numbered 0..n-1 and each one links to the previous one. */
  ledgerChain: { count: number; contiguous: boolean; linked: boolean };
  summary: string;
}

export type Sha256 = (text: string) => Promise<string>;

/**
 * Verify a mission's proof bundle against ledger messages read independently.
 * `sha256` is injected so the browser can use crypto.subtle and Node can use node:crypto.
 */
export async function verifyBundle(bundle: ProofBundle, ledger: LedgerCopy[], sha256: Sha256): Promise<BundleVerification> {
  // Proofs on the ledger for this mission, first copy per event (a lost receipt can publish an identical second copy).
  const byEvent = new Map<string, { copy: LedgerCopy; rec: LedgerRecord }>();
  for (const copy of [...ledger].sort((a, b) => a.sequenceNumber - b.sequenceNumber)) {
    const rec = parseLedgerRecord(copy.message);
    if (!rec || rec.m !== bundle.missionId || byEvent.has(rec.e)) continue;
    byEvent.set(rec.e, { copy, rec });
  }

  // 1. The ledger alone: numbering and links.
  const onLedger = [...byEvent.values()].sort((a, b) => a.rec.s - b.rec.s);
  const contiguous = onLedger.every((x, i) => x.rec.s === i);
  const linked = onLedger.every((x, i) => x.rec.ph === (i === 0 ? GENESIS_HASH : onLedger[i - 1]!.rec.eh));

  // 2. Each event the server shows: recompute, then compare with consensus.
  const events: BundleEventResult[] = [];
  let expectedPrevious = GENESIS_HASH;
  for (const ev of [...bundle.events].sort((a, b) => a.sequence - b.sequence)) {
    const problems: string[] = [];
    let evidence: string;
    try {
      evidence = await sha256(canonicalize(JSON.parse(ev.payloadJson)));
    } catch {
      evidence = await sha256(ev.payloadJson);
    }
    const header: EventHeader = {
      schemaVersion: ev.schemaVersion,
      eventId: ev.eventId,
      missionId: ev.missionId,
      sequence: ev.sequence,
      eventType: ev.eventType,
      agent: ev.agent,
      policyVersion: ev.policyVersion,
      timestamp: ev.timestamp,
      evidenceHash: evidence,
      previousEventHash: ev.previousEventHash,
    };
    const eventHash = await sha256(canonicalize(header));
    const checks: BundleEventResult["checks"] = {
      evidenceHash: evidence === ev.evidenceHash,
      eventHash: eventHash === ev.eventHash,
      chainLink: ev.previousEventHash === expectedPrevious,
      matchesLedger: null,
    };
    if (!checks.evidenceHash) problems.push("The evidence no longer matches the hash it claims");
    if (!checks.eventHash) problems.push("The event header no longer matches its hash");
    if (!checks.chainLink) problems.push("The hash chain is broken before this event");
    const onChain = byEvent.get(ev.eventId);
    let status: BundleEventResult["status"];
    if (!onChain) {
      status = "NOT_ON_LEDGER";
      problems.push("No consensus record found for this event (yet)");
    } else {
      const r = onChain.rec;
      checks.matchesLedger = r.h === evidence && r.eh === eventHash && r.ph === ev.previousEventHash && r.s === ev.sequence && r.t === ev.eventType;
      if (!checks.matchesLedger) problems.push("The record on Hedera says something different");
      status = checks.evidenceHash && checks.eventHash && checks.chainLink && checks.matchesLedger ? "VALID" : "TAMPERED";
    }
    if (status === "NOT_ON_LEDGER" && (!checks.evidenceHash || !checks.eventHash || !checks.chainLink)) status = "TAMPERED";
    events.push({
      eventId: ev.eventId,
      eventType: ev.eventType,
      sequence: ev.sequence,
      status,
      ledgerSequenceNumber: onChain?.copy.sequenceNumber ?? null,
      consensusTimestamp: onChain?.copy.consensusTimestamp ?? null,
      checks,
      problems,
    });
    expectedPrevious = ev.eventHash;
  }

  // 3. Completeness: everything consensus recorded must still be shown.
  const shown = new Set(bundle.events.map((e) => e.eventId));
  const missingFromBundle = onLedger
    .filter((x) => !shown.has(x.rec.e))
    .map((x) => ({ eventId: x.rec.e, eventType: x.rec.t, sequence: typeof x.rec.s === "number" ? x.rec.s : null, ledgerSequenceNumber: x.copy.sequenceNumber, consensusTimestamp: x.copy.consensusTimestamp }));

  const tampered = events.filter((e) => e.status === "TAMPERED");
  const notYet = events.filter((e) => e.status === "NOT_ON_LEDGER");
  const overall: BundleVerification["overall"] = tampered.length || missingFromBundle.length || !contiguous || !linked ? "TAMPERING_DETECTED" : notYet.length ? "INCOMPLETE" : "VALID";
  const parts: string[] = [];
  if (tampered.length) parts.push(`${tampered.length} event(s) do not match their Hedera proof: ${tampered.map((t) => t.eventType).join(", ")}`);
  if (missingFromBundle.length) parts.push(`${missingFromBundle.length} event(s) proven on Hedera are missing: ${missingFromBundle.map((m) => m.eventType).join(", ")}`);
  if (!contiguous || !linked) parts.push("the proofs on Hedera do not form one unbroken chain");
  const summary =
    overall === "TAMPERING_DETECTED"
      ? parts.join(" · ")
      : overall === "INCOMPLETE"
        ? `${notYet.length} event(s) are not visible on the ledger yet (consensus or Mirror Node indexing can take a few seconds)`
        : `All ${events.length} events were recomputed here and match their consensus records, which form one unbroken chain`;
  return { overall, events, missingFromBundle, ledgerChain: { count: onLedger.length, contiguous, linked }, summary };
}
