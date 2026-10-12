/**
 * LEMHAF — AI research & supplier analysis.
 * Ranks candidate offers and explains trade-offs. It RECOMMENDS; it can never authorize money.
 * REAL_AI when Claude answers; FALLBACK (rule-based, clearly labeled) otherwise.
 */
import { type ExecutionMode, type Mission, type Offer, Recommendation, type Supplier } from "@eljoker/shared";
import { z } from "zod";
import { type AiClient, AiUnavailableError } from "../ai/aiClient";
import { canonicalize } from "../lib/canonical";
import { hoursUntil } from "./marketplace";

export interface LemhafResult {
  recommendation: Recommendation;
  mode: ExecutionMode;
  model: string | null;
  fallbackReason: string | null;
  latencyMs: number | null;
}

/** Structured-output contract for Claude (no numeric constraints; validated by `Recommendation` afterwards). */
export const AiRecommendation = z.object({
  recommendedOfferId: z.string(),
  ranking: z.array(z.object({ offerId: z.string(), rank: z.number(), score: z.number(), rationale: z.string() })),
  summary: z.string(),
  tradeoffs: z.array(z.string()),
  concerns: z.array(z.string()),
  statedFacts: z.object({ supplierName: z.string(), totalPrice: z.number(), deliveryTimeHours: z.number(), claimsSupplierVerified: z.boolean() }),
});

const SYSTEM = `You are LEMHAF, the research analyst of EL JOKER, an emergency procurement system for humanitarian missions in Tunisia.
You receive a mission and candidate supplier offers (fictional demo data). Rank every offer and recommend exactly one.

How to rank:
- Hard requirement: delivery time must fit within the hours remaining before the mission deadline. Offers that miss the deadline rank below offers that meet it.
- Then prefer offers that cover all requested items, then lower total price, then faster delivery.
- Supplier "claims" are self-declared marketing statements, not evidence.
- Prices, line totals and offer totals are computed and checked by the system: use them as given, do not recompute them.

Boundaries:
- You only recommend. You cannot approve, authorize or execute payments. An independent verifier (NASNES) and a deterministic policy engine (3ASES) decide.
- Do not invent facts. statedFacts must restate the recommended offer exactly as given (supplier name, total price, delivery hours). Set claimsSupplierVerified to true only if you are asserting the supplier is verified.
- Keep rationale, summary, trade-offs and concerns short (one sentence each). Output only the requested JSON.`;

function buildUserPrompt(mission: Mission, offers: Offer[], suppliers: Map<string, Supplier>): string {
  const view = {
    mission: {
      description: mission.description,
      location: mission.location,
      beneficiaries: mission.beneficiaries,
      requestedItems: mission.requestedItems,
      maximumBudgetUsd: mission.maximumBudget,
      hoursUntilDeadline: Math.round(hoursUntil(mission.deadline)),
      urgency: mission.urgency,
    },
    offers: offers.map((o) => {
      const s = suppliers.get(o.supplierId);
      return {
        offerId: o.offerId,
        supplierName: s?.name ?? o.supplierId,
        supplierRegion: s?.region,
        supplierClaims: s?.claims ?? [],
        // Line totals are given (already checked by code) so the model never has to redo the arithmetic.
        items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotalUsd: i.lineTotal })),
        totalPriceUsd: o.totalPrice,
        deliveryTimeHours: o.deliveryTimeHours,
      };
    }),
  };
  // Registry verification status is deliberately NOT given: checking it is NASNES's job, not the AI's.
  return `Mission and candidate offers (JSON):\n${canonicalize(view)}`;
}

/** Deterministic, explainable ranking used when Claude is unavailable. */
export function fallbackRank(mission: Mission, offers: Offer[], suppliers: Map<string, Supplier>): Recommendation {
  const hoursLeft = hoursUntil(mission.deadline);
  const cheapest = Math.min(...offers.map((o) => o.totalPrice));
  const scored = offers.map((o) => {
    const coverage = mission.requestedItems.filter((r) => o.items.some((i) => i.name === r.name && i.quantity >= r.quantity)).length / mission.requestedItems.length;
    const onTime = o.deliveryTimeHours <= hoursLeft;
    const score = Math.round(55 * (cheapest / o.totalPrice) + (onTime ? 30 : 0) + 15 * coverage);
    return { o, score, onTime, coverage };
  });
  scored.sort((a, b) => b.score - a.score || a.o.totalPrice - b.o.totalPrice);
  const top = scored[0]!;
  const topSupplier = suppliers.get(top.o.supplierId);
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  return Recommendation.parse({
    recommendedOfferId: top.o.offerId,
    ranking: scored.map((s, i) => ({
      offerId: s.o.offerId,
      rank: i + 1,
      score: Math.min(100, s.score),
      rationale: `${suppliers.get(s.o.supplierId)?.name ?? s.o.supplierId}: ${usd(s.o.totalPrice)}, ${s.o.deliveryTimeHours}h delivery${s.onTime ? "" : " (misses deadline)"}, ${Math.round(s.coverage * 100)}% items covered.`,
    })),
    summary: `Rule-based ranking (price 55%, on-time delivery 30%, item coverage 15%) selects ${topSupplier?.name ?? top.o.supplierId} at ${usd(top.o.totalPrice)}.`,
    tradeoffs: scored.slice(1, 3).map((s) => `${suppliers.get(s.o.supplierId)?.name}: ${usd(s.o.totalPrice)} with ${s.o.deliveryTimeHours}h delivery.`),
    concerns: [
      ...(top.o.totalPrice > mission.maximumBudget ? [`Best offer ${usd(top.o.totalPrice)} is above the ${usd(mission.maximumBudget)} budget.`] : []),
      ...(topSupplier?.claims.length ? [`Supplier claims are self-declared: ${topSupplier.claims.join("; ")}.`] : []),
    ].slice(0, 6),
    statedFacts: { supplierName: topSupplier?.name ?? top.o.supplierId, totalPrice: top.o.totalPrice, deliveryTimeHours: top.o.deliveryTimeHours, claimsSupplierVerified: false },
  });
}

export async function runLemhaf(mission: Mission, offers: Offer[], suppliers: Map<string, Supplier>, ai: AiClient): Promise<LemhafResult> {
  if (offers.length === 0) throw new Error("No candidate offers for this mission");
  if (!ai.available) {
    return { recommendation: fallbackRank(mission, offers, suppliers), mode: "FALLBACK", model: null, fallbackReason: ai.unavailableReason, latencyMs: null };
  }
  try {
    const res = await ai.generateStructured({ system: SYSTEM, user: buildUserPrompt(mission, offers, suppliers), schema: AiRecommendation, maxTokens: 3000 });
    const ids = new Set(offers.map((o) => o.offerId));
    if (!ids.has(res.data.recommendedOfferId)) throw new AiUnavailableError("AI recommended an offer that does not exist");
    // Normalize into the strict domain contract (trims over-long strings, clamps scores).
    const rec = Recommendation.parse({
      ...res.data,
      ranking: res.data.ranking.filter((r) => ids.has(r.offerId)).map((r) => ({ ...r, rank: Math.max(1, Math.round(r.rank)), score: Math.max(0, Math.min(100, r.score)), rationale: r.rationale.slice(0, 300) })),
      summary: res.data.summary.slice(0, 600),
      tradeoffs: res.data.tradeoffs.slice(0, 6).map((t) => t.slice(0, 240)),
      concerns: res.data.concerns.slice(0, 6).map((t) => t.slice(0, 240)),
    });
    return { recommendation: rec, mode: "REAL_AI", model: res.model, fallbackReason: null, latencyMs: res.latencyMs };
  } catch (e) {
    const reason = e instanceof AiUnavailableError ? e.message : `AI output rejected: ${e instanceof Error ? e.message.slice(0, 120) : "invalid"}`;
    return { recommendation: fallbackRank(mission, offers, suppliers), mode: "FALLBACK", model: null, fallbackReason: reason, latencyMs: null };
  }
}
