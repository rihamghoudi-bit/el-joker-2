import { z } from "zod";
import {
  AgentName,
  AgentRun,
  Approval,
  AuditEvent,
  FeedMessage,
  GuardianDecision,
  LedgerMode,
  Mission,
  MissionDraft,
  Offer,
  Payment,
  Recommendation,
  Supplier,
  TrailVerification,
  VerificationResult,
} from "./domain";

export const ScenarioId = z.enum(["A_APPROVED", "B_BUDGET_BLOCK", "C_DUPLICATE_PAYMENT", "D_UNVERIFIED_SUPPLIER", "E_HUMAN_REVIEW", "F_TAMPERING", "G_RECYCLED_INVOICE"]);
export type ScenarioId = z.infer<typeof ScenarioId>;

export const ScenarioInfo = z.object({
  id: ScenarioId,
  letter: z.string(),
  title: z.string(),
  pitch: z.string(),
  /** The natural-language request the operator "sends" for this scenario. */
  request: z.string(),
  expected: z.string(),
  followUp: z.string().nullable(),
});
export type ScenarioInfo = z.infer<typeof ScenarioInfo>;

export const CreateMissionRequest = z
  .object({
    /** Free text request; LEM3ALEM extracts a mission from it. */
    text: z.string().min(10).max(2000).optional(),
    /** Structured mission (preferred, e.g. from the composer). */
    mission: MissionDraft.partial().optional(),
  })
  .refine((v) => v.text !== undefined || v.mission !== undefined, { message: "Provide text or mission" });
export type CreateMissionRequest = z.infer<typeof CreateMissionRequest>;

export const ApprovalRequest = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(5).max(500),
  actorId: z.string().min(2).max(60),
  /** Operator PIN, checked server-side (demo operator authentication). */
  pin: z.string().min(4).max(12),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const MissionSummary = z.object({
  missionId: z.string(),
  description: z.string(),
  location: z.string(),
  maximumBudget: z.number(),
  status: Mission.shape.status,
  scenarioId: z.string().nullable(),
  createdAt: z.string(),
});
export type MissionSummary = z.infer<typeof MissionSummary>;

export const MissionState = z.object({
  mission: Mission,
  missingFields: z.array(z.string()),
  offers: z.array(Offer),
  suppliers: z.array(Supplier),
  recommendation: Recommendation.nullable(),
  agentRuns: z.array(AgentRun),
  verification: VerificationResult.nullable(),
  guardianDecision: GuardianDecision.nullable(),
  approvals: z.array(Approval),
  payments: z.array(Payment),
  auditEvents: z.array(AuditEvent),
  feed: z.array(FeedMessage),
  currentAgent: AgentName.nullable(),
  busy: z.boolean(),
  lastVerification: TrailVerification.nullable(),
});
export type MissionState = z.infer<typeof MissionState>;

export const PublicConfig = z.object({
  appName: z.string(),
  demoMode: z.boolean(),
  ai: z.object({
    enabled: z.boolean(),
    configured: z.boolean(),
    provider: z.string(),
    model: z.string(),
  }),
  hedera: z.object({
    mode: LedgerMode,
    network: z.string(),
    topicId: z.string().nullable(),
    operatorAccountId: z.string().nullable(),
    payeeAccountId: z.string().nullable(),
    mirrorNodeUrl: z.string(),
    topicHashscanUrl: z.string().nullable(),
  }),
  payment: z.object({ hbarPer1000Usd: z.number(), maxSettlementHbar: z.number() }),
  policy: z.object({
    version: z.string(),
    autonomousLimitUsd: z.number(),
    maxTransactionUsd: z.number(),
    humanReviewRiskLevel: z.string(),
    allowedRegions: z.array(z.string()),
    allowedCategories: z.array(z.string()),
  }),
  operators: z.array(z.string()),
  /** How approvals are authenticated. */
  operatorAuth: z.enum(["DEMO_PIN", "DISABLED"]),
});
export type PublicConfig = z.infer<typeof PublicConfig>;

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
