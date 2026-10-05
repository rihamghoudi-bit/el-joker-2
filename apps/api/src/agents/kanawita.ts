/**
 * KANAWITA — authorized payment executor.
 *
 * It does not trust its caller. Before moving any value it independently:
 *   1. rebuilds the Guardian input from fresh DB state and re-runs 3ASES (must be APPROVED)
 *   2. requires NASNES = VERIFIED for the same offer
 *   3. requires a valid, bound human approval whenever the policy asked for one
 *   4. requires the mission to be unpaid and the idempotency key unused (DB unique constraints back this)
 *   5. requires the authorization proof to be anchored on Hedera (live mode)
 * Only then: PAYMENT_INITIATED proof -> testnet transfer -> receipt -> PAYMENT_CONFIRMED proof.
 */
import type { Payment } from "@eljoker/shared";
import type { AppConfig } from "../config";
import type { ProofService } from "../audit/proofService";
import { type Store, UniqueViolation } from "../db/store";
import type { LedgerGateway } from "../hedera/gateway";
import { newId, nowIso } from "../lib/canonical";
import { logger } from "../logger";
import { approvalEvidence, buildGuardianSnapshot, postFeed } from "./context";
import { evaluate } from "./guardian/engine";
import type { LoadedPolicy } from "./guardian/policy";

export type PaymentTrigger = "AUTO" | "AFTER_HUMAN_APPROVAL" | "REPLAY";

export interface PaymentOutcome {
  executed: boolean;
  payment: Payment | null;
  reasons: string[];
}

export class Kanawita {
  private inFlight = new Set<string>();

  constructor(
    private readonly deps: {
      store: Store;
      proofs: ProofService;
      ledger: LedgerGateway;
      policy: LoadedPolicy;
      config: Pick<AppConfig, "operators" | "hedera">;
      anchorTimeoutMs?: number;
    },
  ) {}

  /** Pure authorization check (no side effects). Returns the reasons payment is NOT allowed. */
  authorize(missionId: string): { allowed: boolean; reasons: string[]; snapshot: ReturnType<typeof buildGuardianSnapshot> } {
    const { store, policy, config, ledger } = this.deps;
    const snapshot = buildGuardianSnapshot(store, missionId, ledger.payeeAccountId);
    const reasons: string[] = [];
    if (snapshot.mission.status === "PAID") reasons.push("Mission is already PAID");
    const approval = approvalEvidence(store, missionId, config.operators);
    const result = evaluate(snapshot.input, policy, approval);
    if (result.decision !== "APPROVED") {
      reasons.push(`3ASES re-evaluation: ${result.decision}`);
      for (const c of result.checks.filter((c) => c.outcome !== "PASS")) reasons.push(`${c.label}: ${c.detail}`);
    }
    if (snapshot.verification?.status !== "VERIFIED") reasons.push(`NASNES result is ${snapshot.verification?.status ?? "missing"} (VERIFIED required)`);
    const needsHuman = result.checks.some((c) => c.outcome === "REVIEW");
    if (needsHuman && (!approval || approval.decision !== "APPROVED" || result.approvalId === null)) reasons.push("Required human approval is missing or invalid");
    if (snapshot.input.ledger.idempotencyKeyUsed) reasons.push("Idempotency key already used — this exact payment was already executed");
    if (snapshot.input.ledger.missionHasLivePayment) reasons.push("A payment already exists for this mission");
    if (!snapshot.offer) reasons.push("No offer to pay");
    if (ledger.mode === "LIVE_TESTNET" && !ledger.payeeAccountId) reasons.push("HEDERA_PAYEE_ACCOUNT_ID is not configured");
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], snapshot };
  }

  async execute(missionId: string, trigger: PaymentTrigger): Promise<PaymentOutcome> {
    const { store, proofs, ledger, config } = this.deps;
    if (this.inFlight.has(missionId)) return this.block(missionId, trigger, ["A payment for this mission is already in progress"]);
    this.inFlight.add(missionId);
    try {
      postFeed(store, missionId, "KANAWITA", "working", trigger === "REPLAY" ? "Payment request received again… checking it before anything moves." : "Checking authorization before moving any money…", ["CHECKING AUTHORIZATION"]);
      const auth = this.authorize(missionId);
      if (!auth.allowed) return this.block(missionId, trigger, auth.reasons);
      const { snapshot } = auth;
      const offer = snapshot.offer!;

      // No authorization proof on Hedera => no payment.
      const authEvent = [...store.listAuditEvents(missionId)].reverse().find((e) => e.eventType === "GUARDIAN_APPROVED");
      if (!authEvent) return this.block(missionId, trigger, ["No GUARDIAN_APPROVED proof event on record"]);
      const anchor = await proofs.waitForAnchor(authEvent.eventId, this.deps.anchorTimeoutMs ?? 45_000);
      if (ledger.mode === "LIVE_TESTNET" && anchor.status !== "ANCHORED") return this.block(missionId, trigger, [`Authorization proof not anchored on Hedera (${anchor.error ?? anchor.status})`]);

      const settlement = config.hedera.demoSettlementHbar;
      const payment: Payment = {
        paymentId: newId("pay"),
        missionId,
        offerId: offer.offerId,
        invoiceId: offer.invoiceId,
        idempotencyKey: snapshot.idempotencyKey!,
        amount: offer.totalPrice,
        currency: offer.currency,
        settlementAmount: settlement,
        settlementCurrency: "HBAR",
        payeeAccountId: ledger.payeeAccountId,
        status: "INITIATED",
        mode: ledger.mode,
        hederaTransactionId: null,
        hashscanUrl: null,
        mirrorVerified: false,
        error: null,
        createdAt: nowIso(),
        confirmedAt: null,
      };
      try {
        store.insertPayment(payment); // DB unique constraints: one live payment per mission/invoice/idempotency key
      } catch (e) {
        if (e instanceof UniqueViolation) return this.block(missionId, trigger, ["Database rejected a duplicate payment (unique constraint)"]);
        throw e;
      }
      store.setMissionStatus(missionId, "PAYING");
      proofs.recordEvent({
        missionId,
        eventType: "PAYMENT_INITIATED",
        agent: "KANAWITA",
        summary: `Payment initiated: ${settlement} HBAR scaled demo settlement for $${offer.totalPrice.toLocaleString("en-US")} offer`,
        payload: {
          paymentId: payment.paymentId,
          idempotencyKey: payment.idempotencyKey,
          offerId: offer.offerId,
          invoiceId: offer.invoiceId,
          offerAmountUsd: offer.totalPrice,
          settlement: { amount: settlement, currency: "HBAR", note: "Scaled demo amount on Hedera testnet; not the full offer value" },
          payeeAccountId: ledger.payeeAccountId,
          mode: ledger.mode,
          authorizationEventId: authEvent.eventId,
        },
      });
      postFeed(store, missionId, "KANAWITA", "working", `Authorized. Sending ${settlement} ℏ (scaled demo settlement) on Hedera ${ledger.mode === "LIVE_TESTNET" ? "testnet" : "— SIMULATED, no funds move"}…`, ["PAYING"]);

      let status = "UNKNOWN";
      let txId: string | null = null;
      let error: string | null = null;
      try {
        const res = await ledger.transferHbar({ to: ledger.payeeAccountId ?? "SIMULATED", amountHbar: settlement, memo: `eljoker:${missionId}:${payment.idempotencyKey.slice(0, 16)}` });
        status = res.status;
        txId = res.transactionId;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      if (status === "SUCCESS") {
        payment.status = "CONFIRMED";
        payment.hederaTransactionId = txId;
        payment.hashscanUrl = ledger.hashscanTransactionUrl(txId);
        payment.confirmedAt = nowIso();
        store.updatePayment(payment);
        store.setMissionStatus(missionId, "PAID");
        proofs.recordEvent({
          missionId,
          eventType: "PAYMENT_CONFIRMED",
          agent: "KANAWITA",
          summary: ledger.mode === "LIVE_TESTNET" ? `Payment confirmed by Hedera receipt (${txId})` : "Payment SIMULATED (no Hedera credentials) — no funds moved",
          payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, hederaTransactionId: txId, receiptStatus: status, settlement: { amount: settlement, currency: "HBAR" }, mode: ledger.mode },
        });
        postFeed(
          store,
          missionId,
          "KANAWITA",
          "success",
          ledger.mode === "LIVE_TESTNET" ? `Flous mchet ✅ ${settlement} ℏ confirmed on Hedera testnet. Receipt: SUCCESS.` : `Settlement SIMULATED (no Hedera credentials configured) — no funds moved.`,
          [ledger.mode === "LIVE_TESTNET" ? "PAID" : "PAID · SIMULATED"],
          { paymentId: payment.paymentId, hashscanUrl: payment.hashscanUrl, transactionId: txId },
        );
        if (ledger.mode === "LIVE_TESTNET" && txId) void this.confirmOnMirror(payment);
        return { executed: true, payment, reasons: [] };
      }

      payment.status = "FAILED";
      payment.hederaTransactionId = txId;
      payment.hashscanUrl = ledger.hashscanTransactionUrl(txId);
      payment.error = error ?? `Receipt status ${status}`;
      store.updatePayment(payment);
      store.setMissionStatus(missionId, "PAYMENT_FAILED");
      proofs.recordEvent({
        missionId,
        eventType: "PAYMENT_FAILED",
        agent: "KANAWITA",
        summary: `Payment failed: ${payment.error}`,
        payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, hederaTransactionId: txId, error: payment.error, mode: ledger.mode },
      });
      postFeed(store, missionId, "KANAWITA", "alert", `Payment failed: ${payment.error}. Nothing was marked as paid.`, ["PAYMENT FAILED"]);
      return { executed: false, payment, reasons: [payment.error] };
    } finally {
      this.inFlight.delete(missionId);
    }
  }

  private block(missionId: string, trigger: PaymentTrigger, reasons: string[]): PaymentOutcome {
    const { store, proofs } = this.deps;
    logger.warn("kanawita.payment_blocked", { missionId, trigger, reasons });
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_BLOCKED",
      agent: "KANAWITA",
      summary: trigger === "REPLAY" ? "Duplicate payment attempt rejected" : "Payment refused: authorization requirements not met",
      payload: { trigger, reasons },
    });
    postFeed(
      store,
      missionId,
      "KANAWITA",
      "alert",
      trigger === "REPLAY" ? "La la! Same payment twice? Rejected. 🛑" : "I cannot pay: authorization requirements are not met.",
      [trigger === "REPLAY" ? "DUPLICATE BLOCKED" : "PAYMENT REFUSED"],
      { reasons },
    );
    return { executed: false, payment: null, reasons };
  }

  private async confirmOnMirror(payment: Payment) {
    const { store, ledger } = this.deps;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const tx = await ledger.fetchTransaction(payment.hederaTransactionId!);
        if (tx) {
          payment.mirrorVerified = tx.result === "SUCCESS";
          payment.hashscanUrl = ledger.hashscanTransactionUrl(payment.hederaTransactionId, tx.consensusTimestamp);
          store.updatePayment(payment);
          return;
        }
      } catch (e) {
        logger.warn("kanawita.mirror_check_failed", { error: e });
      }
    }
  }
}
