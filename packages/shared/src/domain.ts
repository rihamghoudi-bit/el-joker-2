import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const AgentName = z.enum(["LEM3ALEM", "LEMHAF", "NASNES", "3ASES", "KANAWITA", "OPERATOR", "SYSTEM"]);
export type AgentName = z.infer<typeof AgentName>;

/** How an agent produced its output. Never claim REAL_AI unless Claude actually answered. */
export const ExecutionMode = z.enum(["REAL_AI", "FALLBACK", "DEMO_DATA", "DETERMINISTIC"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const Currency = z.enum(["USD"]);
export type Currency = z.infer<typeof Currency>;

export const Urgency = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type Urgency = z.infer<typeof Urgency>;

export const ItemCategory = z.enum(["WATER", "MEDICINE", "FOOD", "HYGIENE", "SHELTER", "ELECTRONICS", "OTHER"]);
export type ItemCategory = z.infer<typeof ItemCategory>;

export const MissionStatus = z.enum([
  "NEEDS_INFORMATION",
  "CREATED",
  "RESEARCHING",
  "VERIFYING",
  "EVALUATING",
  "HUMAN_REVIEW",
  "APPROVED",
  "PAYING",
  "PAID",
  "BLOCKED",
  "REJECTED",
  "PAYMENT_FAILED",
  "FAILED",
]);
export type MissionStatus = z.infer<typeof MissionStatus>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const GuardianOutcome = z.enum(["APPROVED", "BLOCKED", "HUMAN_REVIEW_REQUIRED"]);
export type GuardianOutcome = z.infer<typeof GuardianOutcome>;

export const VerificationStatus = z.enum(["VERIFIED", "REJECTED", "NEEDS_REVIEW"]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const AuditEventType = z.enum([
  "MISSION_CREATED",
  "AI_RECOMMENDATION",
  "SUPPLIER_VERIFIED",
  "SUPPLIER_REJECTED",
  "GUARDIAN_APPROVED",
  "GUARDIAN_BLOCKED",
  "HUMAN_REVIEW_REQUIRED",
  "HUMAN_APPROVED",
  "HUMAN_REJECTED",
  "PAYMENT_INITIATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_FAILED",
  "PAYMENT_BLOCKED",
  "TAMPER_DETECTED",
]);
export type AuditEventType = z.infer<typeof AuditEventType>;

export const AnchorStatus = z.enum(["PENDING", "ANCHORED", "SIMULATED", "FAILED"]);
export type AnchorStatus = z.infer<typeof AnchorStatus>;

export const LedgerMode = z.enum(["LIVE_TESTNET", "SIMULATED"]);
export type LedgerMode = z.infer<typeof LedgerMode>;

/* ------------------------------------------------------------------ */
/* Mission                                                             */
/* ------------------------------------------------------------------ */

export const RequestedItem = z.object({
  category: ItemCategory,
  name: z.string().min(2).max(120),
  quantity: z.number().int().positive().max(1_000_000),
  unit: z.string().min(1).max(30),
});
export type RequestedItem = z.infer<typeof RequestedItem>;

/** Fields an operator must provide. LEM3ALEM never invents them. */
export const MissionDraft = z.object({
  description: z.string().min(10).max(1000),
  location: z.string().min(2).max(80),
  beneficiaries: z.number().int().positive().max(10_000_000),
  requestedItems: z.array(RequestedItem).min(1).max(20),
  maximumBudget: z.number().positive().max(100_000_000),
  currency: Currency.default("USD"),
  deadline: z.string().datetime().optional(),
  urgency: Urgency.default("HIGH"),
  constraints: z.array(z.string().max(200)).max(10).default([]),
});
export type MissionDraft = z.infer<typeof MissionDraft>;
export type MissionDraftInput = z.input<typeof MissionDraft>;

export const Mission = MissionDraft.extend({
  missionId: z.string(),
  deadline: z.string(),
  createdAt: z.string(),
  status: MissionStatus,
  scenarioId: z.string().nullable(),
  /** True when the mission was launched from seeded demo data. */
  isDemo: z.boolean(),
});
export type Mission = z.infer<typeof Mission>;

/* ------------------------------------------------------------------ */
/* Supplier / Offer                                                    */
/* ------------------------------------------------------------------ */

export const Supplier = z.object({
  supplierId: z.string(),
  name: z.string(),
  region: z.string(),
  serviceRegions: z.array(z.string()),
  categories: z.array(ItemCategory),
  verified: z.boolean(),
  verificationSource: z.string().nullable(),
  riskFlags: z.array(z.string()),
  /** Self-declared marketing claims. Not evidence. */
  claims: z.array(z.string()),
  isDemo: z.boolean(),
});
export type Supplier = z.infer<typeof Supplier>;

export const OfferItem = z.object({
  category: ItemCategory,
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  lineTotal: z.number().nonnegative(),
});
export type OfferItem = z.infer<typeof OfferItem>;

export const EvidenceDocument = z.object({
  type: z.enum(["QUOTE", "INVOICE", "LICENSE", "DELIVERY_PLAN"]),
  reference: z.string(),
  sha256: z.string(),
});
export type EvidenceDocument = z.infer<typeof EvidenceDocument>;

export const Offer = z.object({
  offerId: z.string(),
  supplierId: z.string(),
  missionId: z.string(),
  items: z.array(OfferItem),
  totalPrice: z.number().nonnegative(),
  currency: Currency,
  deliveryTimeHours: z.number().positive(),
  invoiceId: z.string().nullable(),
  evidence: z.array(EvidenceDocument),
  createdAt: z.string(),
  isDemo: z.boolean(),
});
export type Offer = z.infer<typeof Offer>;

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export const AgentRun = z.object({
  runId: z.string(),
  missionId: z.string(),
  agent: AgentName,
  mode: ExecutionMode,
  status: z.enum(["RUNNING", "DONE", "BLOCKED", "FAILED"]),
  inputHash: z.string(),
  outputSummary: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  fallbackReason: z.string().nullable(),
  latencyMs: z.number().nullable(),
  timestamp: z.string(),
});
export type AgentRun = z.infer<typeof AgentRun>;

/** LEMHAF output contract (validated whether it came from Claude or the fallback). */
export const Recommendation = z.object({
  recommendedOfferId: z.string(),
  ranking: z
    .array(
      z.object({
        offerId: z.string(),
        rank: z.number().int().positive(),
        score: z.number().min(0).max(100),
        rationale: z.string().max(300),
      }),
    )
    .min(1),
  summary: z.string().max(600),
  tradeoffs: z.array(z.string().max(240)).max(6),
  concerns: z.array(z.string().max(240)).max(6),
  /** Facts the recommender asserts. NASNES checks them against records. */
  statedFacts: z.object({
    supplierName: z.string(),
    totalPrice: z.number(),
    deliveryTimeHours: z.number(),
    claimsSupplierVerified: z.boolean(),
  }),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const VerificationCheck = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  severity: z.enum(["REJECT", "REVIEW", "INFO"]),
  detail: z.string(),
});
export type VerificationCheck = z.infer<typeof VerificationCheck>;

export const VerificationResult = z.object({
  verificationId: z.string(),
  missionId: z.string(),
  offerId: z.string(),
  supplierId: z.string(),
  status: VerificationStatus,
  checks: z.array(VerificationCheck),
  reasons: z.array(z.string()),
  verifiedAt: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const GuardianCheck = z.object({
  id: z.string(),
  label: z.string(),
  outcome: z.enum(["PASS", "REVIEW", "BLOCK"]),
  detail: z.string(),
});
export type GuardianCheck = z.infer<typeof GuardianCheck>;

export const GuardianDecision = z.object({
  decisionId: z.string(),
  missionId: z.string(),
  decision: GuardianOutcome,
  policyVersion: z.string(),
  checks: z.array(GuardianCheck),
  reasons: z.array(z.string()),
  riskLevel: RiskLevel,
  riskScore: z.number(),
  riskFactors: z.array(z.string()),
  inputHash: z.string(),
  approvalId: z.string().nullable(),
  evaluatedAt: z.string(),
});
export type GuardianDecision = z.infer<typeof GuardianDecision>;

export const Approval = z.object({
  approvalId: z.string(),
  missionId: z.string(),
  actorId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string(),
  timestamp: z.string(),
  policyVersion: z.string(),
  /** Binds the approval to the exact Guardian evaluation the operator saw. */
  guardianInputHash: z.string(),
});
export type Approval = z.infer<typeof Approval>;

/* ------------------------------------------------------------------ */
/* Audit + proof                                                       */
/* ------------------------------------------------------------------ */

export const AnchorInfo = z.object({
  status: AnchorStatus,
  network: z.string().nullable(),
  topicId: z.string().nullable(),
  sequenceNumber: z.number().nullable(),
  transactionId: z.string().nullable(),
  consensusTimestamp: z.string().nullable(),
  hashscanUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type AnchorInfo = z.infer<typeof AnchorInfo>;

export const AuditEvent = z.object({
  schemaVersion: z.string(),
  eventId: z.string(),
  missionId: z.string(),
  sequence: z.number().int().nonnegative(),
  eventType: AuditEventType,
  agent: AgentName,
  policyVersion: z.string(),
  summary: z.string(),
  /** Full off-chain evidence. Only its hash goes to Hedera. */
  payload: z.record(z.string(), z.unknown()),
  evidenceHash: z.string(),
  previousEventHash: z.string(),
  eventHash: z.string(),
  timestamp: z.string(),
  anchor: AnchorInfo,
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const PaymentStatus = z.enum(["INITIATED", "SUBMITTED", "CONFIRMED", "FAILED"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const Payment = z.object({
  paymentId: z.string(),
  missionId: z.string(),
  offerId: z.string(),
  invoiceId: z.string().nullable(),
  idempotencyKey: z.string(),
  amount: z.number(),
  currency: Currency,
  settlementAmount: z.number(),
  settlementCurrency: z.literal("HBAR"),
  payeeAccountId: z.string().nullable(),
  status: PaymentStatus,
  mode: LedgerMode,
  hederaTransactionId: z.string().nullable(),
  hashscanUrl: z.string().nullable(),
  mirrorVerified: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type Payment = z.infer<typeof Payment>;

export const FeedMessage = z.object({
  id: z.string(),
  missionId: z.string(),
  agent: AgentName,
  kind: z.enum(["status", "working", "result", "success", "alert", "proof"]),
  text: z.string(),
  chips: z.array(z.string()),
  data: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type FeedMessage = z.infer<typeof FeedMessage>;

export const EventVerificationStatus = z.enum(["VALID", "TAMPERED", "MISSING_PROOF", "PENDING", "SIMULATED_VALID"]);
export type EventVerificationStatus = z.infer<typeof EventVerificationStatus>;

export const EventVerification = z.object({
  eventId: z.string(),
  eventType: AuditEventType,
  sequence: z.number(),
  status: EventVerificationStatus,
  local: z.object({
    storedEvidenceHash: z.string(),
    recomputedEvidenceHash: z.string(),
    storedEventHash: z.string(),
    recomputedEventHash: z.string(),
    previousEventHash: z.string(),
  }),
  ledger: z
    .object({
      source: z.enum(["MIRROR_NODE", "SIMULATED_LEDGER"]),
      evidenceHash: z.string(),
      eventHash: z.string(),
      previousEventHash: z.string(),
      consensusTimestamp: z.string().nullable(),
      sequenceNumber: z.number().nullable(),
      topicId: z.string().nullable(),
      hashscanUrl: z.string().nullable(),
    })
    .nullable(),
  checks: z.object({
    evidenceHashIntact: z.boolean(),
    eventHashIntact: z.boolean(),
    chainLinkValid: z.boolean(),
    matchesLedger: z.boolean().nullable(),
  }),
  problems: z.array(z.string()),
});
export type EventVerification = z.infer<typeof EventVerification>;

export const TrailVerification = z.object({
  missionId: z.string(),
  verifiedAt: z.string(),
  overall: z.enum(["VALID", "TAMPERING_DETECTED", "PENDING", "UNVERIFIABLE"]),
  ledgerMode: LedgerMode,
  events: z.array(EventVerification),
  summary: z.string(),
});
export type TrailVerification = z.infer<typeof TrailVerification>;
