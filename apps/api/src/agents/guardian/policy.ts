import type { RiskLevel } from "@eljoker/shared";
import { hashCanonical } from "../../lib/canonical";
import { REFERENCE_PRICES } from "../../seed/demoData";
import basePolicy from "./policy.json" with { type: "json" };

export interface Policy {
  name: string;
  version: string;
  currency: string;
  allowedRegions: string[];
  allowedCategories: string[];
  autonomousLimitUsd: number;
  maxTransactionUsd: number;
  humanReviewRiskLevel: RiskLevel;
  priceAnomaly: { reviewAbovePct: number; blockAbovePct: number; reviewBelowPct: number };
  budgetWarningRatio: number;
  evaluableMissionStates: string[];
  riskWeights: { aboveAutonomousLimit: number; nearBudget: number; supplierRiskFlag: number; priceAnomaly: number; criticalUrgency: number };
  riskBands: { medium: number; high: number; critical: number };
  referencePrices: Record<string, number>;
}

export interface PolicyOverrides {
  autonomousLimitUsd?: number;
  maxTransactionUsd?: number;
  humanReviewRiskLevel?: RiskLevel;
}

export interface LoadedPolicy extends Policy {
  /** `version+hash` — any override changes the effective policy hash, so decisions stay attributable. */
  effectiveVersion: string;
  hash: string;
}

/** Centralized policy: base JSON + env overrides. The only place limits are defined. */
export function loadPolicy(overrides: PolicyOverrides = {}): LoadedPolicy {
  const policy: Policy = {
    ...(basePolicy as Omit<Policy, "referencePrices" | "humanReviewRiskLevel"> & { humanReviewRiskLevel: string }),
    humanReviewRiskLevel: (overrides.humanReviewRiskLevel ?? basePolicy.humanReviewRiskLevel) as RiskLevel,
    autonomousLimitUsd: overrides.autonomousLimitUsd ?? basePolicy.autonomousLimitUsd,
    maxTransactionUsd: overrides.maxTransactionUsd ?? basePolicy.maxTransactionUsd,
    referencePrices: { ...REFERENCE_PRICES },
  };
  if (policy.autonomousLimitUsd > policy.maxTransactionUsd) {
    throw new Error("Policy invalid: autonomous limit exceeds maximum transaction limit");
  }
  const hash = hashCanonical(policy);
  return { ...policy, hash, effectiveVersion: `${policy.version}+${hash.slice(0, 8)}` };
}

export const RISK_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const riskAtLeast = (a: RiskLevel, b: RiskLevel) => RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b);

/** Accent/case-insensitive region comparison ("Gabes" == "Gabès"). */
export function normalizeRegion(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}
