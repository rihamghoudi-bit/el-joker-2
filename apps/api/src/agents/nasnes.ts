/**
 * NASNES — independent verification. Deterministic code, independent of the AI it checks.
 * Verifies the recommended offer against the supplier registry, the mission and the evidence,
 * and checks the recommender's stated facts for unsupported claims.
 */
import type { Mission, Offer, Recommendation, Supplier, VerificationCheck, VerificationResult, VerificationStatus } from "@eljoker/shared";
import { newId, nowIso, round2 } from "../lib/canonical";
import { itemKey, REFERENCE_PRICES } from "../seed/demoData";
import { normalizeRegion } from "./guardian/policy";
import { hoursUntil } from "./marketplace";

export interface NasnesContext {
  mission: Mission;
  offer: Offer | null;
  supplier: Supplier | null;
  recommendation: Recommendation;
  /** Offers on OTHER missions that carry the same invoice id. */
  invoiceReusedElsewhere: boolean;
  /** A live payment already references this invoice. */
  invoiceAlreadyPaid: boolean;
  /** Below this % under reference, a price is "suspiciously low". */
  suspiciousBelowPct: number;
}

export function verifyRecommendation(ctx: NasnesContext): VerificationResult {
  const checks: VerificationCheck[] = [];
  const add = (id: string, label: string, passed: boolean, severity: VerificationCheck["severity"], detail: string) => checks.push({ id, label, passed, severity, detail });
  const { mission, offer, supplier, recommendation } = ctx;

  if (!offer) {
    add("OFFER_EXISTS", "Recommended offer exists", false, "REJECT", `Offer ${recommendation.recommendedOfferId} not found`);
  }
  // 1. Supplier exists in registry
  add("SUPPLIER_EXISTS", "Supplier in registry", !!supplier, "REJECT", supplier ? `${supplier.name} found in registry` : "Supplier is not in the registry");

  if (offer && supplier) {
    // 2. Supplier verified with a verification source
    const verified = supplier.verified && !!supplier.verificationSource;
    add("SUPPLIER_VERIFIED", "Supplier verified", verified, "REJECT", verified ? `Verified — ${supplier.verificationSource}` : `Not verified${supplier.riskFlags.length ? ` (flags: ${supplier.riskFlags.join(", ")})` : ""}`);

    // 3. Region
    const loc = normalizeRegion(mission.location);
    const serves = supplier.serviceRegions.some((r) => normalizeRegion(r) === loc);
    add("REGION", "Serves mission region", serves, "REJECT", serves ? `Serves ${mission.location}` : `Does not serve ${mission.location}`);

    // 4. Required items present in full quantity
    const missing = mission.requestedItems.filter((r) => !offer.items.some((i) => i.name === r.name && i.quantity >= r.quantity));
    add("ITEMS_PRESENT", "All requested items present", missing.length === 0, "REJECT", missing.length === 0 ? `${offer.items.length}/${mission.requestedItems.length} items in full quantity` : `Missing: ${missing.map((m) => m.name).join(", ")}`);

    // 5. Arithmetic consistency
    const lineErrors = offer.items.filter((i) => Math.abs(round2(i.quantity * i.unitPrice) - i.lineTotal) > 0.01);
    const sum = round2(offer.items.reduce((a, i) => a + i.lineTotal, 0));
    const arithmeticOk = lineErrors.length === 0 && Math.abs(sum - offer.totalPrice) <= 0.01;
    add("ARITHMETIC", "Price arithmetic consistent", arithmeticOk, "REJECT", arithmeticOk ? `Line totals sum to $${offer.totalPrice.toLocaleString("en-US")}` : `Lines sum to $${sum} but offer states $${offer.totalPrice}`);

    // 6. Evidence exists
    const hasQuote = offer.evidence.some((d) => d.type === "QUOTE");
    const hasInvoice = !!offer.invoiceId && offer.evidence.some((d) => d.type === "INVOICE");
    const hasLicense = offer.evidence.some((d) => d.type === "LICENSE");
    const evidenceOk = hasQuote && hasInvoice && hasLicense;
    add("EVIDENCE", "Evidence documents", evidenceOk, "REJECT", evidenceOk ? "Quote, invoice and license evidence present (hashed)" : `Missing: ${[!hasQuote && "quote", !hasInvoice && "invoice", !hasLicense && "license"].filter(Boolean).join(", ")}`);

    // 7. Duplicate offer / invoice
    const dup = ctx.invoiceReusedElsewhere || ctx.invoiceAlreadyPaid;
    add("DUPLICATE_INVOICE", "Invoice not reused", !dup, "REJECT", dup ? `Invoice ${offer.invoiceId} already used ${ctx.invoiceAlreadyPaid ? "by a payment" : "by another mission"}` : `Invoice ${offer.invoiceId} is new`);

    // 8. Unsupported AI claims: the recommender's stated facts must match the records
    const f = recommendation.statedFacts;
    const claimProblems: string[] = [];
    if (f.supplierName !== supplier.name) claimProblems.push(`supplier "${f.supplierName}" ≠ "${supplier.name}"`);
    if (Math.abs(f.totalPrice - offer.totalPrice) > 1) claimProblems.push(`price $${f.totalPrice} ≠ $${offer.totalPrice}`);
    if (Math.abs(f.deliveryTimeHours - offer.deliveryTimeHours) > 0.5) claimProblems.push(`delivery ${f.deliveryTimeHours}h ≠ ${offer.deliveryTimeHours}h`);
    if (f.claimsSupplierVerified && !supplier.verified) claimProblems.push("claims supplier is verified, registry says it is not");
    add("AI_CLAIMS", "Recommendation claims supported", claimProblems.length === 0, "REVIEW", claimProblems.length === 0 ? "Stated facts match the records" : `Unsupported: ${claimProblems.join("; ")}`);

    // 9. Suspicious inconsistencies: implausibly low prices, deadline miss
    const lows = offer.items
      .map((i) => ({ i, ref: REFERENCE_PRICES[itemKey(i)] }))
      .filter(({ i, ref }) => ref && ((ref - i.unitPrice) / ref) * 100 > ctx.suspiciousBelowPct)
      .map(({ i, ref }) => `${i.name} $${i.unitPrice} vs ref $${ref}`);
    add("SUSPICIOUS_PRICING", "Plausible pricing", lows.length === 0, "REVIEW", lows.length === 0 ? "Unit prices plausible vs reference" : `Suspiciously low: ${lows.join("; ")}`);
    const fits = offer.deliveryTimeHours <= hoursUntil(mission.deadline);
    add("DEADLINE", "Delivery meets deadline", fits, "REVIEW", fits ? `${offer.deliveryTimeHours}h fits the deadline` : `${offer.deliveryTimeHours}h misses the deadline`);
  }

  const failed = checks.filter((c) => !c.passed);
  const status: VerificationStatus = failed.some((c) => c.severity === "REJECT") ? "REJECTED" : failed.some((c) => c.severity === "REVIEW") ? "NEEDS_REVIEW" : "VERIFIED";
  return {
    verificationId: newId("ver"),
    missionId: mission.missionId,
    offerId: recommendation.recommendedOfferId,
    supplierId: offer?.supplierId ?? "unknown",
    status,
    checks,
    reasons: failed.map((c) => `${c.label}: ${c.detail}`),
    verifiedAt: nowIso(),
  };
}
