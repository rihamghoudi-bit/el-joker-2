/**
 * 3ASES — deterministic Guardian.
 *
 * NO LLM. NO network. NO clock-dependent logic. NO randomness.
 * `evaluate(input, policy)` is a pure function: same input + same policy => same decision.
 * (decisionId/evaluatedAt are attached by the caller, outside this function.)
 */
import type { GuardianCheck, GuardianOutcome, ItemCategory, MissionStatus, RiskLevel, Urgency, VerificationStatus } from "@eljoker/shared";
import { money } from "@eljoker/shared";
import { hashCanonical, round2 } from "../../lib/canonical";
import { type LoadedPolicy, normalizeRegion, riskAtLeast } from "./policy";

export interface GuardianInput {
  mission: {
    missionId: string;
    status: MissionStatus;
    location: string;
    maximumBudget: number;
    currency: string;
    urgency: Urgency;
  };
  offer: {
    offerId: string;
    supplierId: string;
    totalPrice: number;
    currency: string;
    invoiceId: string | null;
    items: { key: string; category: ItemCategory; quantity: number; unitPrice: number }[];
  } | null;
  supplier: {
    supplierId: string;
    inRegistry: boolean;
    verified: boolean;
    serviceRegions: string[];
    riskFlags: string[];
  } | null;
  verification: { verificationId: string; status: VerificationStatus; offerId: string } | null;
  ledger: {
    /** A non-failed payment already exists for this mission. */
    missionHasLivePayment: boolean;
    /** This invoice is already attached to a live payment or another mission's offer. */
    invoiceAlreadyUsed: boolean;
    /** The idempotency key for this exact payment was already used. */
    idempotencyKeyUsed: boolean;
  };
}

export interface ApprovalEvidence {
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  actorId: string;
  actorAuthorized: boolean;
  guardianInputHash: string;
  policyVersion: string;
}

export interface GuardianResult {
  decision: GuardianOutcome;
  checks: GuardianCheck[];
  reasons: string[];
  riskLevel: RiskLevel;
  riskScore: number;
  riskFactors: string[];
  inputHash: string;
  policyVersion: string;
  approvalId: string | null;
}

/** Hash of the facts the Guardian decided on. Human approvals are bound to it. */
export function guardianInputHash(input: GuardianInput, policy: LoadedPolicy): string {
  // Workflow status is excluded: it moves (HUMAN_REVIEW -> APPROVED) while the decided facts must not.
  const { status: _status, ...missionFacts } = input.mission;
  return hashCanonical({ input: { ...input, mission: missionFacts }, policyVersion: policy.effectiveVersion });
}

export function evaluate(input: GuardianInput, policy: LoadedPolicy, approval: ApprovalEvidence | null = null): GuardianResult {
  const checks: GuardianCheck[] = [];
  const add = (id: string, label: string, outcome: GuardianCheck["outcome"], detail: string) => checks.push({ id, label, outcome, detail });

  const { mission, offer, supplier, verification, ledger } = input;
  const riskFactors: string[] = [];
  let riskScore = 0;
  const w = policy.riskWeights;

  // 1. Valid mission state
  const stateOk = policy.evaluableMissionStates.includes(mission.status);
  add("MISSION_STATE", "Valid mission state", stateOk ? "PASS" : "BLOCK", stateOk ? `Mission is ${mission.status}` : `Mission is ${mission.status}; spending is not allowed in this state`);

  // 2. An offer must exist
  if (!offer || !supplier) {
    add("OFFER_PRESENT", "Offer under evaluation", "BLOCK", "No recommended offer to evaluate");
  }

  // 3. NASNES verification required (must match the offer under evaluation)
  if (!verification) add("NASNES_VERIFIED", "NASNES verification", "BLOCK", "No independent verification on record");
  else if (offer && verification.offerId !== offer.offerId) add("NASNES_VERIFIED", "NASNES verification", "BLOCK", "Verification refers to a different offer");
  else if (verification.status === "VERIFIED") add("NASNES_VERIFIED", "NASNES verification", "PASS", "Evidence independently verified");
  else add("NASNES_VERIFIED", "NASNES verification", "BLOCK", `NASNES result is ${verification.status}; payment requires VERIFIED`);

  if (offer && supplier) {
    // 4. Verified supplier
    const verifiedOk = supplier.inRegistry && supplier.verified;
    add("SUPPLIER_VERIFIED", "Verified supplier", verifiedOk ? "PASS" : "BLOCK", verifiedOk ? "Supplier is verified in the registry" : supplier.inRegistry ? "Supplier is in the registry but NOT verified" : "Supplier is not in the registry");

    // 5. Region allowed (policy list + supplier actually serves the mission location)
    const loc = normalizeRegion(mission.location);
    const regionAllowed = policy.allowedRegions.some((r) => normalizeRegion(r) === loc);
    const served = supplier.serviceRegions.some((r) => normalizeRegion(r) === loc);
    add(
      "REGION_ALLOWED",
      "Allowed region",
      regionAllowed && served ? "PASS" : "BLOCK",
      !regionAllowed ? `${mission.location} is outside the policy's allowed regions` : !served ? `Supplier does not serve ${mission.location}` : `${mission.location} is an allowed region served by the supplier`,
    );

    // 6. Spending category
    const badCats = [...new Set(offer.items.map((i) => i.category))].filter((c) => !policy.allowedCategories.includes(c));
    add("CATEGORY_ALLOWED", "Allowed spending category", badCats.length === 0 ? "PASS" : "BLOCK", badCats.length === 0 ? "All items are in allowed categories" : `Not allowed: ${badCats.join(", ")}`);

    // 7. Currency
    const curOk = offer.currency === mission.currency && offer.currency === policy.currency;
    add("CURRENCY", "Currency match", curOk ? "PASS" : "BLOCK", curOk ? `${offer.currency}` : `Offer ${offer.currency} vs mission ${mission.currency}`);

    // 8. Budget
    const total = round2(offer.totalPrice);
    if (total > mission.maximumBudget) {
      add("BUDGET", "Within mission budget", "BLOCK", `Offer ${money(total)} exceeds budget ${money(mission.maximumBudget)} by ${money(round2(total - mission.maximumBudget))}`);
    } else {
      add("BUDGET", "Within mission budget", "PASS", `Offer ${money(total)} ≤ budget ${money(mission.maximumBudget)}`);
      if (total / mission.maximumBudget >= policy.budgetWarningRatio) {
        riskScore += w.nearBudget;
        riskFactors.push(`Offer uses ≥${Math.round(policy.budgetWarningRatio * 100)}% of budget`);
      }
    }

    // 9. Price anomaly vs reference prices
    let worstAbove = 0;
    let worstBelow = 0;
    const anomalies: string[] = [];
    for (const it of offer.items) {
      const ref = policy.referencePrices[it.key];
      if (!ref || it.quantity === 0) continue;
      const pct = ((it.unitPrice - ref) / ref) * 100;
      if (pct > worstAbove) worstAbove = pct;
      if (-pct > worstBelow) worstBelow = -pct;
      if (pct > policy.priceAnomaly.reviewAbovePct || -pct > policy.priceAnomaly.reviewBelowPct) anomalies.push(`${it.key} ${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`);
    }
    if (worstAbove > policy.priceAnomaly.blockAbovePct) add("PRICE_ANOMALY", "Price anomaly", "BLOCK", `Overpriced vs reference: ${anomalies.join(", ")}`);
    else if (anomalies.length > 0) {
      add("PRICE_ANOMALY", "Price anomaly", "REVIEW", `Unusual unit prices vs reference: ${anomalies.join(", ")}`);
      riskScore += w.priceAnomaly;
      riskFactors.push("Unit prices deviate from reference");
    } else add("PRICE_ANOMALY", "Price anomaly", "PASS", "Unit prices within reference tolerance");

    // 10. Duplicate invoice
    add("DUPLICATE_INVOICE", "Duplicate invoice", !offer.invoiceId ? "BLOCK" : ledger.invoiceAlreadyUsed ? "BLOCK" : "PASS", !offer.invoiceId ? "Offer has no invoice reference" : ledger.invoiceAlreadyUsed ? `Invoice ${offer.invoiceId} was already used` : `Invoice ${offer.invoiceId} is unique`);

    // 11. Duplicate payment
    const dup = ledger.missionHasLivePayment || ledger.idempotencyKeyUsed;
    add("DUPLICATE_PAYMENT", "Duplicate payment", dup ? "BLOCK" : "PASS", dup ? (ledger.missionHasLivePayment ? "This mission already has a payment" : "Idempotency key already used") : "No prior payment for this mission");

    // 12. Transaction / autonomous limits
    if (total > policy.maxTransaction) add("TRANSACTION_LIMIT", "Transaction limit", "BLOCK", `${money(total)} exceeds the hard limit ${money(policy.maxTransaction)}`);
    else if (total > policy.autonomousLimit) {
      add("TRANSACTION_LIMIT", "Autonomous spending limit", "REVIEW", `${money(total)} exceeds the autonomous limit ${money(policy.autonomousLimit)} — a human must decide`);
      riskScore += w.aboveAutonomousLimit;
      riskFactors.push("Above autonomous spending limit");
    } else add("TRANSACTION_LIMIT", "Autonomous spending limit", "PASS", `${money(total)} ≤ autonomous limit ${money(policy.autonomousLimit)}`);

    // Supplier risk flags contribute to risk
    for (const f of supplier.riskFlags) {
      riskScore += w.supplierRiskFlag;
      riskFactors.push(`Supplier flag: ${f}`);
    }
  }
  if (mission.urgency === "CRITICAL") {
    riskScore += w.criticalUrgency;
    riskFactors.push("Critical urgency (pressure to cut corners)");
  }

  const hasBlock = checks.some((c) => c.outcome === "BLOCK");
  let riskLevel: RiskLevel = hasBlock ? "CRITICAL" : riskScore >= policy.riskBands.critical ? "CRITICAL" : riskScore >= policy.riskBands.high ? "HIGH" : riskScore >= policy.riskBands.medium ? "MEDIUM" : "LOW";

  // 13. Human approval threshold (risk-based)
  if (!hasBlock) {
    const needsHuman = riskAtLeast(riskLevel, policy.humanReviewRiskLevel);
    add("HUMAN_APPROVAL_THRESHOLD", "Human approval threshold", needsHuman ? "REVIEW" : "PASS", needsHuman ? `Risk ${riskLevel} ≥ ${policy.humanReviewRiskLevel} requires a human decision` : `Risk ${riskLevel} below ${policy.humanReviewRiskLevel}`);
  }

  const inputHash = guardianInputHash(input, policy);
  const reasons = checks.filter((c) => c.outcome !== "PASS").map((c) => `${c.label}: ${c.detail}`);
  const needsReview = checks.some((c) => c.outcome === "REVIEW");

  let decision: GuardianOutcome;
  let approvalId: string | null = null;
  if (hasBlock) decision = "BLOCKED";
  else if (!needsReview) decision = "APPROVED";
  else if (!approval) decision = "HUMAN_REVIEW_REQUIRED";
  else if (!approval.actorAuthorized) {
    decision = "HUMAN_REVIEW_REQUIRED";
    reasons.push(`Approval by "${approval.actorId}" ignored: actor is not an authorized operator`);
  } else if (approval.guardianInputHash !== inputHash || approval.policyVersion !== policy.effectiveVersion) {
    decision = "HUMAN_REVIEW_REQUIRED";
    reasons.push("Approval is stale: mission facts or policy changed after the operator decided");
  } else if (approval.decision === "REJECTED") {
    decision = "BLOCKED";
    approvalId = approval.approvalId;
    reasons.push(`Operator ${approval.actorId} rejected the transaction`);
  } else {
    decision = "APPROVED";
    approvalId = approval.approvalId;
    reasons.push(`Operator ${approval.actorId} approved the reviewed transaction`);
  }
  if (decision === "BLOCKED") riskLevel = hasBlock ? "CRITICAL" : riskLevel;

  return { decision, checks, reasons, riskLevel, riskScore, riskFactors, inputHash, policyVersion: policy.effectiveVersion, approvalId };
}
