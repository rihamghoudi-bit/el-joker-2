/**
 * KANAWITA — authorized payment executor.
 *
 * It does not trust its caller. Before moving any value it independently:
 *   1. rebuilds the Guardian input from fresh DB state and re-runs 3ASES (must be APPROVED)
 *   2. requires NASNES = VERIFIED for the same offer
 *   3. requires a valid, bound human approval whenever the policy asked for one
 *   4. requires the mission to be unpaid and the idempotency key unused (DB unique constraints back this)
 *   5. requires the authorization proof to be anchored on Hedera (live mode)
 *
 * Two ways to pay:
 *   - Within the autonomous limit: from the agents' own account. PAYMENT_INITIATED proof -> transfer -> receipt -> PAYMENT_CONFIRMED.
 *   - Above it: the money sits in a 2-of-2 vault on Hedera. When 3ASES asks for a human, KANAWITA locks the payment as a
 *     Hedera schedule signed with the agents' key (1 of 2). Only the approver's signature releases it, and Hedera itself
 *     executes the transfer. A rejection deletes the schedule. Hedera enforces the approval instead of just recording it.
 */
import type { Payment } from "@eljoker/shared";
import { money } from "@eljoker/shared";
import type { AppConfig } from "../config";
import type { ProofService } from "../audit/proofService";
import { type Store, UniqueViolation } from "../db/store";
import type { LedgerGateway, SettlementAsset } from "../hedera/gateway";
import { newId, nowIso } from "../lib/canonical";
import { logger } from "../logger";
import { approvalEvidence, buildGuardianSnapshot, type GuardianSnapshot, postFeed } from "./context";
import { evaluate } from "./guardian/engine";
import type { PolicyRegistry } from "./guardian/policy";

export type PaymentTrigger = "AUTO" | "AFTER_HUMAN_APPROVAL" | "REPLAY";

/** Scaled HBAR settlement: proportional to the authorized amount in dinars, capped, 4 decimals (min 0.0001 HBAR). */
export function settlementFor(amount: number, hbarPer1000: number, maxHbar: number): number {
  const raw = (amount / 1000) * hbarPer1000;
  return Math.max(0.0001, Math.min(maxHbar, Math.round(raw * 10_000) / 10_000));
}

/** Amount to transfer: the full offer amount in the stablecoin (1 token = 1 dinar in the demo), or scaled HBAR. */
export function settlementAmount(amount: number, asset: SettlementAsset, hbarPer1000: number, maxHbar: number): number {
  return asset.kind === "TOKEN" ? Math.round(amount * 10 ** asset.decimals) / 10 ** asset.decimals : settlementFor(amount, hbarPer1000, maxHbar);
}

const fmt = (amount: number, asset: SettlementAsset) =>
  asset.kind === "TOKEN" ? `${amount.toLocaleString("en-US", { maximumFractionDigits: asset.decimals })} ${asset.symbol}` : `${amount} ℏ`;

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
      policies: PolicyRegistry;
      config: Pick<AppConfig, "operators" | "hedera">;
      anchorTimeoutMs?: number;
    },
  ) {}

  private settlementOf(amount: number): number {
    const { ledger, config } = this.deps;
    return settlementAmount(amount, ledger.settlement, config.hedera.hbarPer1000, config.hedera.maxSettlementHbar);
  }

  private settlementFields(): Pick<Payment, "settlementCurrency" | "settlementTokenId"> {
    const s = this.deps.ledger.settlement;
    return { settlementCurrency: s.symbol, settlementTokenId: s.kind === "TOKEN" ? s.tokenId : null };
  }

  /** Pure authorization check (no side effects). Returns the reasons payment is NOT allowed. */
  authorize(missionId: string): { allowed: boolean; reasons: string[]; snapshot: GuardianSnapshot; humanApproved: boolean } {
    const { store, policies, config, ledger } = this.deps;
    const snapshot = buildGuardianSnapshot(store, missionId, ledger.payeeAccountId);
    const reasons: string[] = [];
    if (snapshot.mission.status === "PAID") reasons.push("Mission is already PAID");
    const approval = approvalEvidence(store, missionId, config.operators);
    const result = evaluate(snapshot.input, policies.forMission(snapshot.mission), approval);
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
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], snapshot, humanApproved: needsHuman && result.approvalId !== null };
  }

  async execute(missionId: string, trigger: PaymentTrigger): Promise<PaymentOutcome> {
    const { store, proofs, ledger } = this.deps;
    if (this.inFlight.has(missionId)) return this.block(missionId, trigger, ["A payment for this mission is already in progress"]);
    this.inFlight.add(missionId);
    try {
      postFeed(store, missionId, "KANAWITA", "working", trigger === "REPLAY" ? "Payment request received again… checking it before anything moves." : "Checking authorization before moving any money…", ["CHECKING AUTHORIZATION"]);
      const auth = this.authorize(missionId);
      if (!auth.allowed) return this.block(missionId, trigger, auth.reasons);

      // No authorization proof on Hedera => no payment.
      const authEvent = [...store.listAuditEvents(missionId)].reverse().find((e) => e.eventType === "GUARDIAN_APPROVED");
      if (!authEvent) return this.block(missionId, trigger, ["No GUARDIAN_APPROVED proof event on record"]);
      const anchor = await proofs.waitForAnchor(authEvent.eventId, this.deps.anchorTimeoutMs ?? 45_000);
      if (ledger.mode === "LIVE_TESTNET" && anchor.status !== "ANCHORED") return this.block(missionId, trigger, [`Authorization proof not anchored on Hedera (${anchor.error ?? anchor.status})`]);

      // Above the autonomous limit the money is in the vault: only the approver's signature on Hedera can release it.
      if (auth.humanApproved && ledger.vault.enabled) {
        const locked = store.findScheduledPayment(missionId) ?? (await this.lockInVault(missionId, "AT_APPROVAL"));
        if (!locked) return this.block(missionId, trigger, ["Could not lock the payment in the Hedera vault"]);
        return await this.releaseFromVault(missionId, locked, authEvent.eventId);
      }
      return await this.payFromAgentAccount(missionId, auth.snapshot, authEvent.eventId);
    } finally {
      this.inFlight.delete(missionId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Within the autonomous limit                                         */
  /* ------------------------------------------------------------------ */

  private async payFromAgentAccount(missionId: string, snapshot: GuardianSnapshot, authorizationEventId: string): Promise<PaymentOutcome> {
    const { store, proofs, ledger, config } = this.deps;
    const offer = snapshot.offer!;
    const settlement = this.settlementOf(offer.totalPrice);
    const payment: Payment = {
      paymentId: newId("pay"),
      missionId,
      offerId: offer.offerId,
      invoiceId: offer.invoiceId,
      idempotencyKey: snapshot.idempotencyKey!,
      amount: offer.totalPrice,
      currency: offer.currency,
      settlementAmount: settlement,
      ...this.settlementFields(),
      source: "OPERATOR",
      scheduleId: null,
      scheduleHashscanUrl: null,
      vaultAccountId: null,
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
      store.insertPayment(payment); // DB unique constraints: one open payment per mission/invoice/idempotency key
    } catch (e) {
      if (e instanceof UniqueViolation) return this.block(missionId, "AUTO", ["Database rejected a duplicate payment (unique constraint)"]);
      throw e;
    }
    store.setMissionStatus(missionId, "PAYING");
    const asset = ledger.settlement;
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_INITIATED",
      agent: "KANAWITA",
      summary: `Payment initiated: ${fmt(settlement, asset)} for the ${money(offer.totalPrice)} offer`,
      payload: {
        paymentId: payment.paymentId,
        idempotencyKey: payment.idempotencyKey,
        offerId: offer.offerId,
        invoiceId: offer.invoiceId,
        offerAmount: offer.totalPrice,
        source: "OPERATOR",
        settlement:
          asset.kind === "TOKEN"
            ? { amount: settlement, currency: asset.symbol, tokenId: asset.tokenId, note: "HTS demo dinar token, 1 token = 1 TND in the demo" }
            : { amount: settlement, currency: "HBAR", rate: `${config.hedera.hbarPer1000} HBAR per 1,000 TND (cap ${config.hedera.maxSettlementHbar} HBAR)`, note: "Scaled demo amount on Hedera testnet, proportional to the authorized offer" },
        payeeAccountId: ledger.payeeAccountId,
        mode: ledger.mode,
        authorizationEventId,
      },
    });
    postFeed(store, missionId, "KANAWITA", "working", `Authorized. Sending ${fmt(settlement, asset)}${asset.kind === "HBAR" ? " (scaled demo settlement)" : ""} on Hedera ${ledger.mode === "LIVE_TESTNET" ? "testnet" : "— SIMULATED, no funds move"}…`, ["PAYING"]);

    let status = "UNKNOWN";
    let txId: string | null = null;
    let error: string | null = null;
    try {
      const res = await ledger.transfer({ to: ledger.payeeAccountId ?? "SIMULATED", amount: settlement, memo: `eljoker:${missionId}:${payment.idempotencyKey.slice(0, 16)}` });
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
        payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, hederaTransactionId: txId, receiptStatus: status, source: "OPERATOR", settlement: { amount: settlement, currency: asset.symbol, tokenId: asset.kind === "TOKEN" ? asset.tokenId : null }, mode: ledger.mode },
      });
      postFeed(
        store,
        missionId,
        "KANAWITA",
        "success",
        ledger.mode === "LIVE_TESTNET" ? `Payment sent ✅ ${fmt(settlement, asset)} confirmed on Hedera testnet. Receipt: SUCCESS.` : `Settlement SIMULATED (no Hedera credentials configured) — no funds moved.`,
        [ledger.mode === "LIVE_TESTNET" ? "PAID" : "PAID · SIMULATED"],
        { paymentId: payment.paymentId, hashscanUrl: payment.hashscanUrl, transactionId: txId },
      );
      if (ledger.mode === "LIVE_TESTNET" && txId) void this.confirmOnMirror(payment);
      return { executed: true, payment, reasons: [] };
    }
    return this.fail(missionId, payment, txId, error ?? `Receipt status ${status}`);
  }

  /* ------------------------------------------------------------------ */
  /* Above the autonomous limit: the Hedera vault                        */
  /* ------------------------------------------------------------------ */

  /**
   * Lock the payment on Hedera as a scheduled transfer from the 2-of-2 vault, signed with the agents' key only.
   * Called when 3ASES asks for a human (and again at approval time if that first attempt failed).
   * Returns the SCHEDULED payment, or null if nothing could be locked.
   */
  async lockInVault(missionId: string, when: "AT_REVIEW" | "AT_APPROVAL"): Promise<Payment | null> {
    const { store, ledger, policies } = this.deps;
    if (!ledger.vault.enabled) return null;
    const existing = store.findScheduledPayment(missionId);
    if (existing) return existing;
    const snapshot = buildGuardianSnapshot(store, missionId, ledger.payeeAccountId);
    const offer = snapshot.offer;
    const decision = evaluate(snapshot.input, policies.forMission(snapshot.mission), approvalEvidence(store, missionId, this.deps.config.operators));
    // Only lock what 3ASES would pay once a human approves: verified, nothing blocking, nothing already paid.
    const problems: string[] = [];
    if (!offer || !snapshot.idempotencyKey) problems.push("no offer");
    if (snapshot.verification?.status !== "VERIFIED") problems.push(`NASNES is ${snapshot.verification?.status ?? "missing"}`);
    if (decision.checks.some((c) => c.outcome === "BLOCK")) problems.push("a policy rule blocks this payment");
    if (snapshot.input.ledger.missionHasLivePayment || snapshot.input.ledger.idempotencyKeyUsed) problems.push("a payment already exists");
    if (ledger.mode === "LIVE_TESTNET" && !ledger.payeeAccountId) problems.push("HEDERA_PAYEE_ACCOUNT_ID is not configured");
    if (problems.length) {
      logger.warn("kanawita.vault_lock_skipped", { missionId, problems });
      return null;
    }

    const settlement = this.settlementOf(offer!.totalPrice);
    const payment: Payment = {
      paymentId: newId("pay"),
      missionId,
      offerId: offer!.offerId,
      invoiceId: offer!.invoiceId,
      idempotencyKey: snapshot.idempotencyKey!,
      amount: offer!.totalPrice,
      currency: offer!.currency,
      settlementAmount: settlement,
      ...this.settlementFields(),
      source: "VAULT",
      scheduleId: null,
      scheduleHashscanUrl: null,
      vaultAccountId: ledger.vault.accountId,
      payeeAccountId: ledger.payeeAccountId,
      status: "SCHEDULED",
      mode: ledger.mode,
      hederaTransactionId: null,
      hashscanUrl: null,
      mirrorVerified: false,
      error: null,
      createdAt: nowIso(),
      confirmedAt: null,
    };
    try {
      store.insertPayment(payment);
    } catch (e) {
      if (e instanceof UniqueViolation) return store.findScheduledPayment(missionId);
      throw e;
    }

    const locked = await this.createSchedule(missionId, payment, when);
    if (!locked) {
      // Nothing reached the ledger: drop the reservation so the same payment can be locked again at approval time.
      store.deleteUncommittedPayment(payment.paymentId);
      return null;
    }
    return locked;
  }

  /** Create the vault schedule for a reserved payment, record its proof and tell the team. Null if the ledger refused. */
  private async createSchedule(missionId: string, payment: Payment, when: "AT_REVIEW" | "AT_APPROVAL" | "RELOCK"): Promise<Payment | null> {
    const { store, proofs, ledger } = this.deps;
    const asset = ledger.settlement;
    const settlement = payment.settlementAmount;
    let schedule;
    try {
      // The memo makes each schedule unique (Hedera refuses an identical pending schedule).
      schedule = await ledger.scheduleVaultTransfer({ to: ledger.payeeAccountId ?? "SIMULATED", amount: settlement, memo: `eljoker:${missionId}:${payment.idempotencyKey.slice(0, 12)}:${Date.now().toString(36)}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("kanawita.vault_lock_failed", { missionId, error: msg });
      postFeed(store, missionId, "KANAWITA", "alert", `I could not lock the payment in the Hedera vault (${msg}). It stays stopped; nothing moved.`, ["VAULT LOCK FAILED"]);
      return null;
    }
    payment.status = "SCHEDULED";
    payment.error = null;
    payment.scheduleId = schedule.scheduleId;
    payment.scheduleHashscanUrl = ledger.hashscanScheduleUrl(schedule.scheduleId);
    payment.hederaTransactionId = schedule.scheduledTransactionId;
    store.updatePayment(payment);
    const guardian = store.latestGuardianDecision(missionId);
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_SCHEDULED",
      agent: "KANAWITA",
      summary: `Payment locked in the vault: schedule ${schedule.scheduleId} needs the approver's signature (1 of 2 signed)`,
      payload: {
        paymentId: payment.paymentId,
        idempotencyKey: payment.idempotencyKey,
        scheduleId: schedule.scheduleId,
        scheduleCreateTransactionId: schedule.transactionId,
        scheduledTransactionId: schedule.scheduledTransactionId,
        vaultAccountId: ledger.vault.accountId,
        vaultKey: "2-of-2 threshold: agents + approver",
        signedBy: ["agents"],
        offerId: payment.offerId,
        invoiceId: payment.invoiceId,
        offerAmount: payment.amount,
        settlement: { amount: settlement, currency: asset.symbol, tokenId: asset.kind === "TOKEN" ? asset.tokenId : null },
        payeeAccountId: ledger.payeeAccountId,
        guardianDecisionId: guardian?.decisionId ?? null,
        guardianInputHash: guardian?.inputHash ?? null,
        lockedAt: when,
        mode: ledger.mode,
      },
    });
    const live = ledger.mode === "LIVE_TESTNET";
    postFeed(
      store,
      missionId,
      "KANAWITA",
      "status",
      live
        ? `Payment locked on Hedera: schedule ${schedule.scheduleId} holds ${fmt(settlement, asset)} from the vault ${ledger.vault.accountId}. My key is 1 of the 2 signatures it needs — I cannot release it alone.`
        : `Payment locked in the vault (SIMULATED schedule ${schedule.scheduleId}): ${fmt(settlement, asset)}. My key is 1 of the 2 signatures it needs — I cannot release it alone.`,
      [live ? "LOCKED ON HEDERA" : "LOCKED · SIMULATED", "1 OF 2 SIGNATURES"],
      { paymentId: payment.paymentId, scheduleId: schedule.scheduleId, scheduleHashscanUrl: payment.scheduleHashscanUrl },
    );
    return payment;
  }

  /** The human approved: add the approver's signature. Hedera executes the transfer on its own once 2 of 2 have signed. */
  private async releaseFromVault(missionId: string, payment: Payment, authorizationEventId: string): Promise<PaymentOutcome> {
    const { store, proofs, ledger } = this.deps;
    const asset = ledger.settlement;
    const live = ledger.mode === "LIVE_TESTNET";
    store.setMissionStatus(missionId, "PAYING");
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_INITIATED",
      agent: "KANAWITA",
      summary: `Approver co-signing schedule ${payment.scheduleId} to release ${fmt(payment.settlementAmount, asset)} from the vault`,
      payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, source: "VAULT", via: "HEDERA_SCHEDULE_SIGN", scheduleId: payment.scheduleId, vaultAccountId: payment.vaultAccountId, settlement: { amount: payment.settlementAmount, currency: payment.settlementCurrency, tokenId: payment.settlementTokenId ?? null }, authorizationEventId, mode: ledger.mode },
    });
    postFeed(store, missionId, "KANAWITA", "working", `Approved. Adding the approver's signature to schedule ${payment.scheduleId}${live ? " on Hedera" : " (SIMULATED)"}…`, ["CO-SIGNING"]);

    let res;
    try {
      res = await ledger.signSchedule(payment.scheduleId!, payment.hederaTransactionId);
      // A Hedera schedule expires (about 30 minutes by default). If it is gone, lock again and co-sign the new one.
      if (!res.executed && /INVALID_SCHEDULE_ID|EXPIRED|DELETED/.test(res.signStatus)) {
        logger.warn("kanawita.schedule_expired_relock", { missionId, scheduleId: payment.scheduleId, status: res.signStatus });
        const previous = payment.scheduleId;
        const relocked = await this.createSchedule(missionId, payment, "RELOCK");
        if (!relocked) return this.fail(missionId, payment, null, `Schedule ${previous} was no longer pending (${res.signStatus}) and could not be locked again`);
        payment = relocked;
        res = await ledger.signSchedule(payment.scheduleId!, payment.hederaTransactionId);
      }
    } catch (e) {
      return this.fail(missionId, payment, payment.hederaTransactionId, e instanceof Error ? e.message : String(e));
    }

    if (res.executed && res.executedStatus === "SUCCESS") {
      const txId = res.scheduledTransactionId ?? payment.hederaTransactionId;
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
        summary: live ? `Vault payment executed by Hedera after the approver co-signed schedule ${payment.scheduleId} (${txId})` : "Vault payment SIMULATED (no Hedera credentials) — no funds moved",
        payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, source: "VAULT", scheduleId: payment.scheduleId, signatures: "2 of 2 (agents + approver)", hederaTransactionId: txId, receiptStatus: res.executedStatus, settlement: { amount: payment.settlementAmount, currency: payment.settlementCurrency, tokenId: payment.settlementTokenId ?? null }, mode: ledger.mode },
      });
      postFeed(
        store,
        missionId,
        "KANAWITA",
        "success",
        live
          ? `Payment released ✅ The approver co-signed and Hedera executed schedule ${payment.scheduleId}: ${fmt(payment.settlementAmount, asset)} paid from the vault. Receipt: SUCCESS.`
          : `Vault payment SIMULATED: both signatures present, schedule ${payment.scheduleId} executed — no funds moved.`,
        [live ? "PAID" : "PAID · SIMULATED", live ? "CO-SIGNED ON HEDERA" : "CO-SIGNED · SIMULATED"],
        { paymentId: payment.paymentId, hashscanUrl: payment.hashscanUrl, transactionId: txId, scheduleId: payment.scheduleId, scheduleHashscanUrl: payment.scheduleHashscanUrl },
      );
      if (live && txId) void this.confirmOnMirror(payment);
      return { executed: true, payment, reasons: [] };
    }
    const why = res.executed ? `Scheduled transfer executed with status ${res.executedStatus}` : `Schedule not executed after the approver's signature (${res.signStatus})`;
    return this.fail(missionId, payment, payment.hederaTransactionId, why);
  }

  /** The human rejected: delete the pending schedule. The vault never releases the funds. */
  async cancelVault(missionId: string, reason: string): Promise<void> {
    const { store, proofs, ledger } = this.deps;
    const payment = store.findScheduledPayment(missionId);
    if (!payment?.scheduleId) return;
    const res = await ledger.deleteSchedule(payment.scheduleId);
    payment.status = "CANCELLED";
    payment.error = `Cancelled: ${reason}`;
    store.updatePayment(payment);
    const deleted = res.status === "SUCCESS";
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_CANCELLED",
      agent: "KANAWITA",
      summary: deleted ? `Schedule ${payment.scheduleId} deleted on the ledger — the vault never released the funds` : `Schedule ${payment.scheduleId} left unsigned (${res.status}) — it can never execute without the approver`,
      payload: { paymentId: payment.paymentId, scheduleId: payment.scheduleId, deleteStatus: res.status, reason, mode: ledger.mode },
    });
    postFeed(
      store,
      missionId,
      "KANAWITA",
      "status",
      deleted
        ? `Schedule ${payment.scheduleId} deleted${ledger.mode === "LIVE_TESTNET" ? " on Hedera" : " (SIMULATED)"}. The vault never released the funds.`
        : `Schedule ${payment.scheduleId} could not be deleted (${res.status}). Without the approver's signature it can never execute, and it expires on its own.`,
      [deleted ? "SCHEDULE DELETED" : "NEVER CO-SIGNED", "NO PAYMENT"],
      { paymentId: payment.paymentId, scheduleId: payment.scheduleId, scheduleHashscanUrl: payment.scheduleHashscanUrl },
    );
  }

  /* ------------------------------------------------------------------ */

  private fail(missionId: string, payment: Payment, txId: string | null, error: string): PaymentOutcome {
    const { store, proofs, ledger } = this.deps;
    payment.status = "FAILED";
    payment.hederaTransactionId = txId;
    payment.hashscanUrl = ledger.hashscanTransactionUrl(txId);
    payment.error = error;
    store.updatePayment(payment);
    store.setMissionStatus(missionId, "PAYMENT_FAILED");
    proofs.recordEvent({
      missionId,
      eventType: "PAYMENT_FAILED",
      agent: "KANAWITA",
      summary: `Payment failed: ${payment.error}`,
      payload: { paymentId: payment.paymentId, idempotencyKey: payment.idempotencyKey, hederaTransactionId: txId, scheduleId: payment.scheduleId ?? null, error: payment.error, mode: ledger.mode },
    });
    postFeed(store, missionId, "KANAWITA", "alert", `Payment failed: ${payment.error}. Nothing was marked as paid.`, ["PAYMENT FAILED"]);
    return { executed: false, payment, reasons: [payment.error] };
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
      trigger === "REPLAY" ? "The same payment twice? Rejected. 🛑" : "I cannot pay: authorization requirements are not met.",
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
