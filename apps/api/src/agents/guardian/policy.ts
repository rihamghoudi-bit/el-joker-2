import { type OrganizationId, organizationOf, type PolicySummary, type RiskLevel } from "@eljoker/shared";
import { hashCanonical } from "../../lib/canonical";
import { REFERENCE_PRICES } from "../../seed/demoData";
import acmePolicy from "./policy.acme.json" with { type: "json" };
import basePolicy from "./policy.json" with { type: "json" };

export interface Policy {
  name: string;
  version: string;
  currency: string;
  allowedRegions: string[];
  allowedCategories: string[];
  autonomousLimit: number;
  maxTransaction: number;
  humanReviewRiskLevel: RiskLevel;
  priceAnomaly: { reviewAbovePct: number; blockAbovePct: number; reviewBelowPct: number };
  budgetWarningRatio: number;
  evaluableMissionStates: string[];
  riskWeights: { aboveAutonomousLimit: number; nearBudget: number; supplierRiskFlag: number; priceAnomaly: number; criticalUrgency: number };
  riskBands: { medium: number; high: number; critical: number };
  referencePrices: Record<string, number>;
}

export interface PolicyOverrides {
  autonomousLimit?: number;
  maxTransaction?: number;
  humanReviewRiskLevel?: RiskLevel;
}

export interface LoadedPolicy extends Policy {
  organizationId: OrganizationId;
  /** `version+hash` — any override changes the effective policy hash, so decisions stay attributable. */
  effectiveVersion: string;
  hash: string;
}

type PolicyFile = Omit<Policy, "referencePrices" | "humanReviewRiskLevel"> & { humanReviewRiskLevel: string };

const POLICY_FILES: Record<OrganizationId, PolicyFile> = {
  NGO_RELIEF: basePolicy as PolicyFile,
  ACME_PROCUREMENT: acmePolicy as PolicyFile,
};

/**
 * Centralized policy: one versioned JSON file per organization (+ env overrides for the NGO, the default
 * organization). The only place limits are defined.
 */
export function loadPolicy(overrides: PolicyOverrides = {}, organizationId: OrganizationId = "NGO_RELIEF"): LoadedPolicy {
  const file = POLICY_FILES[organizationId];
  const o = organizationId === "NGO_RELIEF" ? overrides : {};
  const policy: Policy = {
    ...file,
    humanReviewRiskLevel: (o.humanReviewRiskLevel ?? file.humanReviewRiskLevel) as RiskLevel,
    autonomousLimit: o.autonomousLimit ?? file.autonomousLimit,
    maxTransaction: o.maxTransaction ?? file.maxTransaction,
    referencePrices: { ...REFERENCE_PRICES },
  };
  if (policy.autonomousLimit > policy.maxTransaction) {
    throw new Error(`Policy invalid (${organizationId}): autonomous limit exceeds maximum transaction limit`);
  }
  const hash = hashCanonical(policy);
  return { ...policy, organizationId, hash, effectiveVersion: `${policy.version}+${hash.slice(0, 8)}` };
}

/** Every organization's loaded policy. Missions are evaluated under the policy of the organization they spend for. */
export class PolicyRegistry {
  private readonly byOrg: Record<OrganizationId, LoadedPolicy>;

  constructor(overrides: PolicyOverrides = {}) {
    this.byOrg = {
      NGO_RELIEF: loadPolicy(overrides, "NGO_RELIEF"),
      ACME_PROCUREMENT: loadPolicy(overrides, "ACME_PROCUREMENT"),
    };
  }

  get(organizationId: OrganizationId): LoadedPolicy {
    return this.byOrg[organizationId];
  }

  forMission(mission: { organizationId?: OrganizationId | null } | null | undefined): LoadedPolicy {
    return this.byOrg[mission ? organizationOf(mission) : "NGO_RELIEF"];
  }

  /** The default organization's policy (older endpoints and clients). */
  get default(): LoadedPolicy {
    return this.byOrg.NGO_RELIEF;
  }

  list(): LoadedPolicy[] {
    return Object.values(this.byOrg);
  }

  summaries(): PolicySummary[] {
    return this.list().map((p) => ({
      organizationId: p.organizationId,
      name: p.name,
      version: p.effectiveVersion,
      autonomousLimit: p.autonomousLimit,
      maxTransaction: p.maxTransaction,
      humanReviewRiskLevel: p.humanReviewRiskLevel,
      allowedRegions: p.allowedRegions,
      allowedCategories: p.allowedCategories,
    }));
  }
}

export const RISK_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const riskAtLeast = (a: RiskLevel, b: RiskLevel) => RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b);

/** Accent/case-insensitive region comparison ("Gabes" == "Gabès"). */
export function normalizeRegion(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}
