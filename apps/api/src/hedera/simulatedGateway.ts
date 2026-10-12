import type { Store } from "../db/store";
import type { LedgerGateway, LedgerMessage, LedgerTransaction, SubmitResult, TransferResult } from "./gateway";

/**
 * SIMULATED ledger — used only when Hedera credentials are not configured.
 * It is append-only by API and stored in a separate table the tamper demo never touches,
 * but it is NOT a consensus network. The UI labels everything from here as SIMULATED and shows
 * no transaction ids or HashScan links.
 */
export class SimulatedGateway implements LedgerGateway {
  readonly mode = "SIMULATED" as const;
  readonly topicId = "SIMULATED-TOPIC";
  readonly payeeAccountId = null;
  /** Test hook: make the next N submits fail. */
  failNextSubmits = 0;
  /** Test hook: the message reaches the ledger but the receipt is "lost" (the caller sees an error and retries). */
  lostReceiptNextSubmits = 0;
  failNextTransfer = false;

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

  async transferHbar(_args: { to: string; amountHbar: number; memo: string }): Promise<TransferResult> {
    if (this.failNextTransfer) {
      this.failNextTransfer = false;
      return { transactionId: null, status: "INSUFFICIENT_PAYER_BALANCE", consensusTimestamp: null };
    }
    return { transactionId: null, status: "SUCCESS", consensusTimestamp: null };
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
}
