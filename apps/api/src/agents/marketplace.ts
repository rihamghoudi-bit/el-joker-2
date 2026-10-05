import type { EvidenceDocument, Mission, Offer, OfferItem } from "@eljoker/shared";
import { hashCanonical, newId, nowIso, round2 } from "../lib/canonical";
import { DEMO_SUPPLIERS, type DemoSupplier, itemKey } from "../seed/demoData";
import { normalizeRegion } from "./guardian/policy";

/**
 * DEMO DATA marketplace: the "research tool" LEMHAF queries.
 * It turns fictional supplier price lists into quotes for the mission's requested items.
 * A production deployment would replace this with real supplier APIs / RFQ responses.
 */
export function hoursUntil(deadlineIso: string, now = Date.now()): number {
  return Math.max(0, (new Date(deadlineIso).getTime() - now) / 3_600_000);
}

export function quoteOffers(mission: Mission, suppliers: DemoSupplier[] = DEMO_SUPPLIERS): Offer[] {
  const loc = normalizeRegion(mission.location);
  const rush = hoursUntil(mission.deadline) <= 24;
  const offers: Offer[] = [];
  for (const s of suppliers) {
    if (!s.serviceRegions.some((r) => normalizeRegion(r) === loc)) continue;
    if (s.bidsOnlyOnRush && !rush) continue;
    const items: OfferItem[] = [];
    for (const req of mission.requestedItems) {
      const unitPrice = s.priceList[itemKey(req)];
      if (unitPrice === undefined) continue;
      items.push({ category: req.category, name: req.name, quantity: req.quantity, unitPrice, lineTotal: round2(unitPrice * req.quantity) });
    }
    if (items.length === 0) continue;
    const totalPrice = round2(items.reduce((a, i) => a + i.lineTotal, 0));
    const offerId = newId("off");
    const invoiceId = `INV-${s.invoicePrefix}-${mission.missionId.slice(-8).toUpperCase()}`;
    const quote = { supplierId: s.supplierId, missionId: mission.missionId, items, totalPrice };
    const evidence: EvidenceDocument[] = [{ type: "QUOTE", reference: `QUOTE-${s.invoicePrefix}-${offerId.slice(-6)}`, sha256: hashCanonical(quote) }];
    if (s.hasLicenseEvidence) evidence.push({ type: "LICENSE", reference: `${s.verificationSource ?? "license"}`, sha256: hashCanonical({ license: s.supplierId }) });
    evidence.push({ type: "INVOICE", reference: invoiceId, sha256: hashCanonical({ invoiceId, totalPrice }) });
    offers.push({
      offerId,
      supplierId: s.supplierId,
      missionId: mission.missionId,
      items,
      totalPrice,
      currency: "USD",
      deliveryTimeHours: s.deliveryHours,
      invoiceId,
      evidence,
      createdAt: nowIso(),
      isDemo: true,
    });
  }
  return offers;
}
