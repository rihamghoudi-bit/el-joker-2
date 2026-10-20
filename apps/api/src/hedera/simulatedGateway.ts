import type { Store } from "../db/store";
import type { LedgerGateway, LedgerMessage, LedgerTransaction, ScheduleInfo, ScheduleResult, ScheduleSignResult, SettlementAsset, SubmitResult, TransferResult } from "./gateway";

/**
 * SIMULATED ledger — used only when Hedera credentials are not configured.
 * It is append-only by API and stored in a separate table the tamper demo never touches,
 * but it is NOT a consensus network. The UI labels everything from here as SIMULATED and shows
 * no transaction ids or HashScan links.
 *
 * It also simulates the 2-of-2 vault: a schedule records which keys signed and "executes" only once both did.
 */
export class SimulatedGateway implements LedgerGateway {
  readonly mode = "SIMULATED" as const;
  readonly topicId = "SIMULATED-TOPIC";
  readonly payeeAccountId = null;
  readonly settlement: SettlementAsset = { kind: "HBAR", symbol: "HBAR" };
  readonly vault = { enabled: true, accountId: "SIMULATED-VAULT" };
  /** Test hook: make the next N submits fail. */
  failNextSubmits = 0;
  /** Test hook: the message reaches the ledger but the receipt is "lost" (the caller sees an error and retries). */
  lostReceiptNextSubmits = 0;
  failNextTransfer = false;
  /** Test hook: the next schedule creation fails. */
  failNextSchedule = false;

  constructor(private readonly store: Store) {}

  async submitMessage(message: string): Promise<SubmitResult> {
    if (this.failNextSubmits > 0) {
      this.failNextSubmits -= 1;
      throw new Error("Simulated ledger outage");
    }
    const { sequenceNumber, consensusTimestamp } = this.store.appendSimulatedMessage(this.topicId, message);
    if (this.lostReceiptNextSubmits > 0) {
      this.lostReceiptNextSubmits -= 1;
      throw new Error("Receipt timed out (message already on the ledger)");
    }
    return { topicId: this.topicId, sequenceNumber, transactionId: null, consensusTimestamp };
  }

  async transfer(_args: { to: string; amount: number; memo: string }): Promise<TransferResult> {
    if (this.failNextTransfer) {
      this.failNextTransfer = false;
      return { transactionId: null, status: "INSUFFICIENT_PAYER_BALANCE", consensusTimestamp: null };
    }
    return { transactionId: null, status: "SUCCESS", consensusTimestamp: null };
  }

  async scheduleVaultTransfer(args: { to: string; amount: number; memo: string }): Promise<ScheduleResult> {
    if (this.failNextSchedule) {
      this.failNextSchedule = false;
      throw new Error("Simulated ledger rejected the schedule");
    }
    const scheduleId = this.store.createSimulatedSchedule({ ...args, signers: ["agents"], executed: false, deleted: false, executedAt: null });
    return { scheduleId, transactionId: null, scheduledTransactionId: null };
  }

  async signSchedule(scheduleId: string): Promise<ScheduleSignResult> {
    const s = this.store.getSimulatedSchedule(scheduleId);
    if (!s) return { signStatus: "INVALID_SCHEDULE_ID", executed: false, executedStatus: null, scheduledTransactionId: null };
    if (s.deleted) return { signStatus: "SCHEDULE_ALREADY_DELETED", executed: false, executedStatus: null, scheduledTransactionId: null };
    if (s.executed) return { signStatus: "SCHEDULE_ALREADY_EXECUTED", executed: true, executedStatus: "SUCCESS", scheduledTransactionId: null };
    const signers = [...new Set([...s.signers, "approver"])];
    // 2-of-2: the transfer runs only once the agents' key AND the approver's key have signed.
    const executed = signers.includes("agents") && signers.includes("approver");
    this.store.updateSimulatedSchedule(scheduleId, { ...s, signers, executed, executedAt: executed ? new Date().toISOString() : null });
    return { signStatus: "SUCCESS", executed, executedStatus: executed ? "SUCCESS" : null, scheduledTransactionId: null };
  }

  async deleteSchedule(scheduleId: string): Promise<{ status: string }> {
    const s = this.store.getSimulatedSchedule(scheduleId);
    if (!s) return { status: "INVALID_SCHEDULE_ID" };
    if (s.executed) return { status: "SCHEDULE_ALREADY_EXECUTED" };
    this.store.updateSimulatedSchedule(scheduleId, { ...s, deleted: true });
    return { status: "SUCCESS" };
  }

  async fetchSchedule(scheduleId: string): Promise<ScheduleInfo | null> {
    const s = this.store.getSimulatedSchedule(scheduleId);
    return s ? { scheduleId, executed: s.executed, deleted: s.deleted, signatures: s.signers.length, executedTimestamp: s.executedAt } : null;
  }

  async fetchTopicMessage(sequenceNumber: number): Promise<LedgerMessage | null> {
    const row = this.store.getSimulatedMessage(sequenceNumber);
    if (!row) return null;
    return { source: "SIMULATED_LEDGER", topicId: row.topicId, sequenceNumber, consensusTimestamp: row.consensusTimestamp, message: row.message };
  }

  async listTopicMessages(sinceIso: string | null): Promise<LedgerMessage[]> {
    return this.store.listSimulatedMessages(sinceIso).map((r) => ({ source: "SIMULATED_LEDGER" as const, topicId: r.topicId, sequenceNumber: r.sequenceNumber, consensusTimestamp: r.consensusTimestamp, message: r.message }));
  }

  async fetchTransaction(_transactionId: string): Promise<LedgerTransaction | null> {
    return null;
  }

  hashscanTransactionUrl(): string | null {
    return null;
  }

  hashscanTopicUrl(): string | null {
    return null;
  }

  hashscanScheduleUrl(): string | null {
    return null;
  }

  hashscanAccountUrl(): string | null {
    return null;
  }

  hashscanTokenUrl(): string | null {
    return null;
  }
}
