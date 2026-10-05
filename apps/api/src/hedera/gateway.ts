import type { LedgerMode } from "@eljoker/shared";

export interface SubmitResult {
  topicId: string;
  sequenceNumber: number;
  transactionId: string | null;
  consensusTimestamp: string | null;
}

export interface TransferResult {
  transactionId: string | null;
  status: string;
  consensusTimestamp: string | null;
}

export interface LedgerMessage {
  source: "MIRROR_NODE" | "SIMULATED_LEDGER";
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string | null;
  /** Decoded UTF-8 message body as published. */
  message: string;
}

export interface LedgerTransaction {
  transactionId: string;
  result: string;
  consensusTimestamp: string | null;
}

/**
 * Everything the app needs from a ledger. Two implementations:
 *  - HederaSdkGateway: real Hedera TESTNET (HCS + HBAR transfer + Mirror Node)
 *  - SimulatedGateway: local stand-in when credentials are missing. Clearly labeled; never fabricates tx ids.
 */
export interface LedgerGateway {
  readonly mode: LedgerMode;
  readonly topicId: string | null;
  readonly payeeAccountId: string | null;
  submitMessage(message: string): Promise<SubmitResult>;
  transferHbar(args: { to: string; amountHbar: number; memo: string }): Promise<TransferResult>;
  /** Independent read-back (Mirror Node for testnet). Returns null when not (yet) available. */
  fetchTopicMessage(sequenceNumber: number): Promise<LedgerMessage | null>;
  /** All topic messages from a consensus time onwards (Mirror Node listing). Used to detect deleted local history. */
  listTopicMessages(sinceIso: string | null): Promise<LedgerMessage[]>;
  fetchTransaction(transactionId: string): Promise<LedgerTransaction | null>;
  hashscanTransactionUrl(transactionId: string | null, consensusTimestamp?: string | null): string | null;
  hashscanTopicUrl(): string | null;
}

export class LedgerError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
    this.name = "LedgerError";
  }
}
