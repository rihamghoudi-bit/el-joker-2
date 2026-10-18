import type { Mission, Offer, Recommendation, Supplier } from "@eljoker/shared";
import { describe, expect, it } from "vitest";
import { AiUnavailableError, type AiClient, StubAiClient } from "../src/ai/aiClient";
import { planMission, ruleBasedExtraction } from "../src/agents/lem3alem";
import { fallbackRank, runLemhaf } from "../src/agents/lemhaf";
import { quoteOffers } from "../src/agents/marketplace";
import { verifyRecommendation } from "../src/agents/nasnes";
import { DEMO_SUPPLIERS, getScenario } from "../src/seed/demoData";

const unavailable: AiClient = { available: false, model: "x", unavailableReason: "ANTHROPIC_API_KEY not configured", generateStructured: async () => { throw new AiUnavailableError("no"); } };
const failing: AiClient = { available: true, model: "claude-test", unavailableReason: null, generateStructured: async () => { throw new AiUnavailableError("Anthropic request timed out"); } };

function mission(id = "A_APPROVED"): Mission {
  const d = getScenario(id)!.draft();
  return { ...(d as Mission), missionId: "msn_test0001", createdAt: new Date().toISOString(), status: "RESEARCHING", scenarioId: id, isDemo: true, currency: "TND", constraints: d.constraints ?? [], urgency: d.urgency ?? "HIGH", deadline: d.deadline! };
}
const suppliers = new Map<string, Supplier>(DEMO_SUPPLIERS.map((s) => [s.supplierId, s]));

describe("LEM3ALEM", () => {
  it("accepts a complete structured mission deterministically", async () => {
    const r = await planMission({ mission: getScenario("A_APPROVED")!.draft() }, unavailable);
    expect(r.status).toBe("CREATED");
    expect(r.mode).toBe("DETERMINISTIC");
    expect(r.draft?.maximumBudget).toBe(15000);
  });

  it("free text: extracts facts with the labeled fallback when AI is unavailable", async () => {
    const r = await planMission({ text: "500 people in Gabès need water and medicine, budget 15,000 TND within 48 hours" }, unavailable);
    expect(r.status).toBe("CREATED");
    expect(r.mode).toBe("FALLBACK");
    expect(r.fallbackReason).toMatch(/not configured/);
    expect(r.draft?.location).toBe("Gabès");
    expect(r.draft?.beneficiaries).toBe(500);
    expect(r.draft?.maximumBudget).toBe(15000);
    expect(r.notes.join(" ")).toMatch(/estimated/);
  });

  it("never invents missing critical facts", async () => {
    const r = await planMission({ text: "We urgently need medicine and water for the families" }, unavailable);
    expect(r.status).toBe("NEEDS_INFORMATION");
    expect(r.missingFields).toEqual(expect.arrayContaining(["location", "beneficiaries", "maximumBudget"]));
  });

  it("uses Claude output when available (REAL_AI) and still validates it", async () => {
    const ai = new StubAiClient("claude-test", () => ({ description: "Water for Sfax", location: "Sfax", beneficiaries: 300, maximumBudgetAmount: 3000, budgetCurrency: "USD", urgency: "HIGH", deadlineHours: 48, items: [{ category: "WATER", name: "Bottled drinking water 1.5L", quantity: 1800, unit: "bottle" }] }));
    const r = await planMission({ text: "300 people in Sfax need water, budget 3000 dollars" }, ai);
    expect(r.mode).toBe("REAL_AI");
    expect(r.model).toBe("claude-test");
    expect(r.draft?.requestedItems[0]?.quantity).toBe(1800);
  });

  it("AI failure falls back and says why", async () => {
    const r = await planMission({ text: "300 people in Sfax need water, budget $3000" }, failing);
    expect(r.mode).toBe("FALLBACK");
    expect(r.fallbackReason).toBe("Anthropic request timed out");
  });

  it("rule-based extraction parses k-suffixed budgets", () => {
    expect(ruleBasedExtraction("budget $12k for 2,000 people in Médenine").maximumBudgetAmount).toBe(12000);
  });
});

describe("Marketplace (demo data)", () => {
  it("express broker only bids on rush orders", () => {
    expect(quoteOffers(mission("A_APPROVED")).some((o) => o.supplierId === "SUP-SAHEL")).toBe(false);
    expect(quoteOffers(mission("D_UNVERIFIED_SUPPLIER")).some((o) => o.supplierId === "SUP-SAHEL")).toBe(true);
  });
  it("quotes have consistent arithmetic and hashed evidence", () => {
    for (const o of quoteOffers(mission())) {
      expect(o.items.reduce((a, i) => a + i.lineTotal, 0)).toBeCloseTo(o.totalPrice, 2);
      expect(o.evidence.every((d) => /^[0-9a-f]{64}$/.test(d.sha256))).toBe(true);
    }
  });
});

describe("LEMHAF", () => {
  it("fallback ranks the cheapest complete on-time offer first", () => {
    const m = mission();
    const offers = quoteOffers(m);
    const rec = fallbackRank(m, offers, suppliers);
    const top = offers.find((o) => o.offerId === rec.recommendedOfferId)!;
    expect(top.supplierId).toBe("SUP-OASIS");
    expect(rec.statedFacts.totalPrice).toBe(top.totalPrice);
  });

  it("REAL_AI path: validated structured output", async () => {
    const m = mission();
    const offers = quoteOffers(m);
    const pick = offers[1]!;
    const ai = new StubAiClient("claude-test", () => ({
      recommendedOfferId: pick.offerId,
      ranking: offers.map((o, i) => ({ offerId: o.offerId, rank: i + 1, score: 90 - i, rationale: "ok" })),
      summary: "Pick",
      tradeoffs: [],
      concerns: [],
      statedFacts: { supplierName: suppliers.get(pick.supplierId)!.name, totalPrice: pick.totalPrice, deliveryTimeHours: pick.deliveryTimeHours, claimsSupplierVerified: false },
    }));
    const r = await runLemhaf(m, offers, suppliers, ai);
    expect(r.mode).toBe("REAL_AI");
    expect(r.recommendation.recommendedOfferId).toBe(pick.offerId);
  });

  it("AI recommending a non-existent offer is rejected and falls back (labeled)", async () => {
    const m = mission();
    const offers = quoteOffers(m);
    const ai = new StubAiClient("claude-test", () => ({ recommendedOfferId: "off_fake", ranking: [{ offerId: "off_fake", rank: 1, score: 99, rationale: "x" }], summary: "x", tradeoffs: [], concerns: [], statedFacts: { supplierName: "x", totalPrice: 1, deliveryTimeHours: 1, claimsSupplierVerified: true } }));
    const r = await runLemhaf(m, offers, suppliers, ai);
    expect(r.mode).toBe("FALLBACK");
    expect(r.fallbackReason).toMatch(/does not exist/);
  });

  it("AI schema violation falls back", async () => {
    const m = mission();
    const r = await runLemhaf(m, quoteOffers(m), suppliers, new StubAiClient("claude-test", () => ({ nonsense: true })));
    expect(r.mode).toBe("FALLBACK");
  });
});

describe("NASNES", () => {
  const setup = (sc = "A_APPROVED", recOver: Partial<Recommendation["statedFacts"]> = {}, offerOver: Partial<Offer> = {}) => {
    const m = mission(sc);
    const offers = quoteOffers(m);
    const rec = fallbackRank(m, offers, suppliers);
    const offer = { ...offers.find((o) => o.offerId === rec.recommendedOfferId)!, ...offerOver };
    return verifyRecommendation({ mission: m, offer, supplier: suppliers.get(offer.supplierId) ?? null, recommendation: { ...rec, statedFacts: { ...rec.statedFacts, ...recOver } }, invoiceReusedElsewhere: false, invoiceAlreadyPaid: false, suspiciousBelowPct: 40 });
  };
  const failed = (r: ReturnType<typeof verifyRecommendation>) => r.checks.filter((c) => !c.passed).map((c) => c.id);

  it("verifies a clean offer", () => {
    expect(setup().status).toBe("VERIFIED");
  });
  it("rejects the unverified rush broker (registry, evidence, suspicious pricing)", () => {
    const r = setup("D_UNVERIFIED_SUPPLIER");
    expect(r.status).toBe("REJECTED");
    expect(failed(r)).toEqual(expect.arrayContaining(["SUPPLIER_VERIFIED", "EVIDENCE", "SUSPICIOUS_PRICING"]));
  });
  it("flags unsupported AI claims", () => {
    const r = setup("A_APPROVED", { totalPrice: 999, supplierName: "Someone else" });
    expect(failed(r)).toContain("AI_CLAIMS");
    expect(r.status).toBe("NEEDS_REVIEW");
  });
  it("rejects arithmetic inconsistencies", () => {
    const r = setup("A_APPROVED", {}, { totalPrice: 3000 });
    expect(failed(r)).toContain("ARITHMETIC");
  });
  it("rejects missing items", () => {
    const m = mission();
    const offers = quoteOffers(m);
    const rec = fallbackRank(m, offers, suppliers);
    const offer = offers.find((o) => o.offerId === rec.recommendedOfferId)!;
    const partial = { ...offer, items: offer.items.slice(1), totalPrice: offer.items.slice(1).reduce((a, i) => a + i.lineTotal, 0) };
    const r = verifyRecommendation({ mission: m, offer: partial, supplier: suppliers.get(offer.supplierId)!, recommendation: rec, invoiceReusedElsewhere: false, invoiceAlreadyPaid: false, suspiciousBelowPct: 40 });
    expect(failed(r)).toContain("ITEMS_PRESENT");
  });
  it("rejects duplicate invoices", () => {
    const m = mission();
    const offers = quoteOffers(m);
    const rec = fallbackRank(m, offers, suppliers);
    const offer = offers.find((o) => o.offerId === rec.recommendedOfferId)!;
    const r = verifyRecommendation({ mission: m, offer, supplier: suppliers.get(offer.supplierId)!, recommendation: rec, invoiceReusedElsewhere: true, invoiceAlreadyPaid: false, suspiciousBelowPct: 40 });
    expect(r.status).toBe("REJECTED");
    expect(failed(r)).toContain("DUPLICATE_INVOICE");
  });
  it("rejects suppliers not in the registry", () => {
    const m = mission();
    const offers = quoteOffers(m);
    const rec = fallbackRank(m, offers, suppliers);
    const offer = offers.find((o) => o.offerId === rec.recommendedOfferId)!;
    const r = verifyRecommendation({ mission: m, offer, supplier: null, recommendation: rec, invoiceReusedElsewhere: false, invoiceAlreadyPaid: false, suspiciousBelowPct: 40 });
    expect(failed(r)).toContain("SUPPLIER_EXISTS");
  });
});
