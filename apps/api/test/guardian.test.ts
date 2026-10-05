import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ApprovalEvidence, evaluate, type GuardianInput, guardianInputHash } from "../src/agents/guardian/engine";
import { loadPolicy } from "../src/agents/guardian/policy";

const policy = loadPolicy();

function input(over: Partial<{ [K in keyof GuardianInput]: Partial<GuardianInput[K]> }> = {}): GuardianInput {
  const base: GuardianInput = {
    mission: { missionId: "msn_1", status: "EVALUATING", location: "Gabès", maximumBudget: 5000, currency: "USD", urgency: "HIGH" },
    offer: {
      offerId: "off_1",
      supplierId: "SUP-OASIS",
      totalPrice: 4150,
      currency: "USD",
      invoiceId: "INV-1",
      items: [
        { key: "water_bottle", category: "WATER", quantity: 3000, unitPrice: 0.5 },
        { key: "medicine_kit", category: "MEDICINE", quantity: 50, unitPrice: 42 },
        { key: "ors", category: "MEDICINE", quantity: 1000, unitPrice: 0.55 },
      ],
    },
    supplier: { supplierId: "SUP-OASIS", inRegistry: true, verified: true, serviceRegions: ["Gabès", "Médenine"], riskFlags: [] },
    verification: { verificationId: "ver_1", status: "VERIFIED", offerId: "off_1" },
    ledger: { missionHasLivePayment: false, invoiceAlreadyUsed: false, idempotencyKeyUsed: false },
  };
  return {
    mission: { ...base.mission, ...over.mission },
    offer: over.offer === null ? null : ({ ...base.offer!, ...over.offer } as GuardianInput["offer"]),
    supplier: over.supplier === null ? null : ({ ...base.supplier!, ...over.supplier } as GuardianInput["supplier"]),
    verification: over.verification === null ? null : ({ ...base.verification!, ...over.verification } as GuardianInput["verification"]),
    ledger: { ...base.ledger, ...over.ledger },
  };
}

const check = (r: ReturnType<typeof evaluate>, id: string) => r.checks.find((c) => c.id === id)?.outcome;

describe("3ASES deterministic guardian", () => {
  it("approves a clean, verified, in-budget offer with LOW risk", () => {
    const r = evaluate(input(), policy);
    expect(r.decision).toBe("APPROVED");
    expect(r.riskLevel).toBe("LOW");
    expect(r.checks.every((c) => c.outcome === "PASS")).toBe(true);
    expect(r.policyVersion).toMatch(/^2\.0\.0\+[0-9a-f]{8}$/);
  });

  it("is deterministic: same input + same policy = identical result", () => {
    const a = evaluate(input(), policy);
    const b = evaluate(structuredClone(input()), loadPolicy());
    expect(b).toEqual(a);
  });

  it("budget: blocks when the offer exceeds the budget", () => {
    const r = evaluate(input({ mission: { maximumBudget: 100 } }), policy);
    expect(r.decision).toBe("BLOCKED");
    expect(check(r, "BUDGET")).toBe("BLOCK");
    expect(r.riskLevel).toBe("CRITICAL");
  });

  it("region: blocks a location outside the policy", () => {
    const r = evaluate(input({ mission: { location: "Tripoli" }, supplier: { serviceRegions: ["Tripoli"] } }), policy);
    expect(check(r, "REGION_ALLOWED")).toBe("BLOCK");
    expect(r.decision).toBe("BLOCKED");
  });

  it("region: accent-insensitive match (Gabes == Gabès)", () => {
    expect(evaluate(input({ mission: { location: "Gabes" } }), policy).decision).toBe("APPROVED");
  });

  it("blocks unverified and unregistered suppliers", () => {
    expect(check(evaluate(input({ supplier: { verified: false } }), policy), "SUPPLIER_VERIFIED")).toBe("BLOCK");
    expect(check(evaluate(input({ supplier: { inRegistry: false } }), policy), "SUPPLIER_VERIFIED")).toBe("BLOCK");
  });

  it("requires NASNES VERIFIED for the same offer", () => {
    expect(check(evaluate(input({ verification: { status: "NEEDS_REVIEW" } }), policy), "NASNES_VERIFIED")).toBe("BLOCK");
    expect(check(evaluate(input({ verification: { status: "REJECTED" } }), policy), "NASNES_VERIFIED")).toBe("BLOCK");
    expect(check(evaluate(input({ verification: { offerId: "other" } }), policy), "NASNES_VERIFIED")).toBe("BLOCK");
    expect(check(evaluate(input({ verification: null }), policy), "NASNES_VERIFIED")).toBe("BLOCK");
  });

  it("blocks duplicate invoices, duplicate payments and used idempotency keys", () => {
    expect(check(evaluate(input({ ledger: { invoiceAlreadyUsed: true } }), policy), "DUPLICATE_INVOICE")).toBe("BLOCK");
    expect(check(evaluate(input({ ledger: { missionHasLivePayment: true } }), policy), "DUPLICATE_PAYMENT")).toBe("BLOCK");
    expect(check(evaluate(input({ ledger: { idempotencyKeyUsed: true } }), policy), "DUPLICATE_PAYMENT")).toBe("BLOCK");
    expect(check(evaluate(input({ offer: { invoiceId: null } }), policy), "DUPLICATE_INVOICE")).toBe("BLOCK");
  });

  it("price anomaly: review when moderately overpriced, block when grossly overpriced", () => {
    const over30 = input({ offer: { items: [{ key: "medicine_kit", category: "MEDICINE", quantity: 50, unitPrice: 60 }], totalPrice: 3000 } });
    const r1 = evaluate(over30, policy);
    expect(check(r1, "PRICE_ANOMALY")).toBe("REVIEW");
    const over80 = input({ offer: { items: [{ key: "medicine_kit", category: "MEDICINE", quantity: 50, unitPrice: 81 }], totalPrice: 4050 } });
    expect(check(evaluate(over80, policy), "PRICE_ANOMALY")).toBe("BLOCK");
  });

  it("blocks disallowed spending categories", () => {
    const r = evaluate(input({ offer: { items: [{ key: "electronics", category: "ELECTRONICS", quantity: 2, unitPrice: 150 }], totalPrice: 300 } }), policy);
    expect(check(r, "CATEGORY_ALLOWED")).toBe("BLOCK");
  });

  it("autonomous limit => HUMAN_REVIEW_REQUIRED; hard limit => BLOCKED", () => {
    const review = evaluate(input({ mission: { maximumBudget: 20000 }, offer: { totalPrice: 16600, items: [] } }), policy);
    expect(review.decision).toBe("HUMAN_REVIEW_REQUIRED");
    expect(check(review, "TRANSACTION_LIMIT")).toBe("REVIEW");
    expect(review.riskLevel).toBe("HIGH");
    const hard = evaluate(input({ mission: { maximumBudget: 90000 }, offer: { totalPrice: 30000, items: [] } }), policy);
    expect(check(hard, "TRANSACTION_LIMIT")).toBe("BLOCK");
  });

  it("blocks spending in invalid mission states (e.g. already PAID)", () => {
    expect(check(evaluate(input({ mission: { status: "PAID" } }), policy), "MISSION_STATE")).toBe("BLOCK");
    expect(check(evaluate(input({ mission: { status: "BLOCKED" } }), policy), "MISSION_STATE")).toBe("BLOCK");
  });

  describe("human approval", () => {
    const reviewInput = input({ mission: { maximumBudget: 20000, status: "HUMAN_REVIEW" }, offer: { totalPrice: 16600, items: [] } });
    const hash = guardianInputHash(reviewInput, policy);
    const approval = (over: Partial<ApprovalEvidence> = {}): ApprovalEvidence => ({ approvalId: "apr_1", decision: "APPROVED", actorId: "ops-lead", actorAuthorized: true, guardianInputHash: hash, policyVersion: policy.effectiveVersion, ...over });

    it("valid bound approval => APPROVED with approvalId", () => {
      const r = evaluate(reviewInput, policy, approval());
      expect(r.decision).toBe("APPROVED");
      expect(r.approvalId).toBe("apr_1");
    });
    it("workflow status change does not invalidate the approval", () => {
      expect(evaluate({ ...reviewInput, mission: { ...reviewInput.mission, status: "APPROVED" } }, policy, approval()).decision).toBe("APPROVED");
    });
    it("rejection => BLOCKED", () => {
      expect(evaluate(reviewInput, policy, approval({ decision: "REJECTED" })).decision).toBe("BLOCKED");
    });
    it("unauthorized actor is ignored", () => {
      expect(evaluate(reviewInput, policy, approval({ actorAuthorized: false })).decision).toBe("HUMAN_REVIEW_REQUIRED");
    });
    it("stale approval (facts changed) is ignored", () => {
      expect(evaluate(reviewInput, policy, approval({ guardianInputHash: "0".repeat(64) })).decision).toBe("HUMAN_REVIEW_REQUIRED");
    });
    it("an approval can never override a BLOCK", () => {
      const blocked = input({ supplier: { verified: false }, mission: { maximumBudget: 20000 }, offer: { totalPrice: 16600, items: [] } });
      expect(evaluate(blocked, policy, approval({ guardianInputHash: guardianInputHash(blocked, policy) })).decision).toBe("BLOCKED");
    });
  });

  it("policy overrides change the effective policy version", () => {
    const p2 = loadPolicy({ autonomousLimitUsd: 1000 });
    expect(p2.effectiveVersion).not.toBe(policy.effectiveVersion);
    expect(evaluate(input(), p2).decision).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("3ASES source contains no LLM / AI / network imports", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/agents/guardian");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const imp of imports) expect(imp).not.toMatch(/anthropic|ai\/|openai|hashgraph|fetch|http/i);
      expect(src).not.toMatch(/\bfetch\(|Math\.random|Date\.now\(/);
    }
  });
});
