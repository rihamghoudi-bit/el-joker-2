import type { AgentName, FeedMessage, Mission, Offer, Supplier, VerificationResult } from "@eljoker/shared";
import type { Store } from "../db/store";
import { hashCanonical, newId, nowIso } from "../lib/canonical";
import { itemKey } from "../seed/demoData";
import type { ApprovalEvidence, GuardianInput } from "./guardian/engine";

export function postFeed(store: Store, missionId: string, agent: AgentName, kind: FeedMessage["kind"], text: string, chips: string[] = [], data: Record<string, unknown> | null = null): FeedMessage {
  const msg: FeedMessage = { id: newId("msg"), missionId, agent, kind, text, chips, data, createdAt: nowIso() };
  store.insertFeed(msg);
  return msg;
}

/**
 * Idempotency key of a payment: the same mission + offer + invoice + amount + payee always yields
 * the same key, and the database refuses to store it twice.
 */
export function paymentIdempotencyKey(missionId: string, offer: Pick<Offer, "offerId" | "invoiceId" | "totalPrice" | "currency">, payee: string | null): string {
  return hashCanonical({ kind: "eljoker.payment/1", missionId, offerId: offer.offerId, invoiceId: offer.invoiceId, amount: offer.totalPrice, currency: offer.currency, payee });
}

export interface GuardianSnapshot {
  mission: Mission;
  offer: Offer | null;
  supplier: Supplier | null;
  verification: VerificationResult | null;
  input: GuardianInput;
  idempotencyKey: string | null;
}

/** Builds the Guardian's input from FRESH database state. Used by the orchestrator and again by KANAWITA. */
export function buildGuardianSnapshot(store: Store, missionId: string, payeeAccountId: string | null): GuardianSnapshot {
  const mission = store.getMission(missionId);
  if (!mission) throw new Error(`mission ${missionId} not found`);
  const rec = store.getRecommendation(missionId);
  const offer = rec ? store.getOffer(rec.recommendedOfferId) : null;
  const supplier = offer ? store.getSupplier(offer.supplierId) : null;
  const verification = store.latestVerification(missionId);
  const idempotencyKey = offer ? paymentIdempotencyKey(missionId, offer, payeeAccountId) : null;
  const livePayments = store.listPayments(missionId).filter((p) => p.status !== "FAILED");
  const invoiceAlreadyUsed = !!offer?.invoiceId && (store.findOffersByInvoice(offer.invoiceId, missionId).length > 0 || (store.findLivePaymentByInvoice(offer.invoiceId)?.missionId ?? missionId) !== missionId);

  const input: GuardianInput = {
    mission: { missionId, status: mission.status, location: mission.location, maximumBudget: mission.maximumBudget, currency: mission.currency, urgency: mission.urgency },
    offer: offer
      ? {
          offerId: offer.offerId,
          supplierId: offer.supplierId,
          totalPrice: offer.totalPrice,
          currency: offer.currency,
          invoiceId: offer.invoiceId,
          items: offer.items.map((i) => ({ key: itemKey(i), category: i.category, quantity: i.quantity, unitPrice: i.unitPrice })),
        }
      : null,
    supplier: offer
      ? supplier
        ? { supplierId: supplier.supplierId, inRegistry: true, verified: supplier.verified, serviceRegions: supplier.serviceRegions, riskFlags: supplier.riskFlags }
        : { supplierId: offer.supplierId, inRegistry: false, verified: false, serviceRegions: [], riskFlags: ["NOT_IN_REGISTRY"] }
      : null,
    verification: verification ? { verificationId: verification.verificationId, status: verification.status, offerId: verification.offerId } : null,
    ledger: {
      missionHasLivePayment: livePayments.length > 0,
      invoiceAlreadyUsed,
      idempotencyKeyUsed: idempotencyKey ? store.findPaymentByIdempotencyKey(idempotencyKey) !== null : false,
    },
  };
  return { mission, offer, supplier, verification, input, idempotencyKey };
}

export function approvalEvidence(store: Store, missionId: string, operators: string[]): ApprovalEvidence | null {
  const a = store.getApproval(missionId);
  if (!a) return null;
  return { approvalId: a.approvalId, decision: a.decision, actorId: a.actorId, actorAuthorized: operators.includes(a.actorId), guardianInputHash: a.guardianInputHash, policyVersion: a.policyVersion };
}
