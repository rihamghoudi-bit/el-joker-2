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

/** What payments settle in. HBAR is a scaled demo amount; the HTS stablecoin carries the full offer amount. */
export type SettlementAsset = { kind: "HBAR"; symbol: "HBAR" } | { kind: "TOKEN"; symbol: string; tokenId: string; decimals: number };

/** A transfer from the vault, created on the ledger as a schedule that waits for the remaining signature. */
export interface ScheduleResult {
  scheduleId: string;
  /** Id of the ScheduleCreate transaction. */
  transactionId: string | null;
  /** Id the inner transfer will have once it executes. */
  scheduledTransactionId: string | null;
}

export interface ScheduleSignResult {
  /** Status of the ScheduleSign transaction itself. */
  signStatus: string;
  /** True when the schedule had every signature it needed and the transfer ran. */
  executed: boolean;
  /** Status of the executed inner transfer (SUCCESS when the money moved). */
  executedStatus: string | null;
  scheduledTransactionId: string | null;
}

export interface ScheduleInfo {
  scheduleId: string;
  executed: boolean;
  deleted: boolean;
  /** How many keys have signed so far (Mirror Node). */
  signatures: number;
  executedTimestamp: string | null;
}

/**
 * Everything the app needs from a ledger. Two implementations:
 *  - HederaSdkGateway: real Hedera TESTNET (HCS + transfers + schedules + Mirror Node)
 *  - SimulatedGateway: local stand-in when credentials are missing. Clearly labeled; never fabricates tx ids.
 */
export interface LedgerGateway {
  readonly mode: LedgerMode;
  readonly topicId: string | null;
  readonly payeeAccountId: string | null;
  readonly settlement: SettlementAsset;
  /** 2-of-2 vault: the agents' key alone cannot move these funds; the approver must co-sign on the ledger. */
  readonly vault: { enabled: boolean; accountId: string | null };
  submitMessage(message: string): Promise<SubmitResult>;
  /** Pays from the agents' own account (payments within the autonomous limit). `amount` is in settlement units. */
  transfer(args: { to: string; amount: number; memo: string }): Promise<TransferResult>;
  /** Creates a scheduled transfer from the vault, signed by the agents' key: it executes only when the approver signs. */
  scheduleVaultTransfer(args: { to: string; amount: number; memo: string }): Promise<ScheduleResult>;
  /** Adds the approver's signature. Hedera then executes the transfer by itself. */
  signSchedule(scheduleId: string, scheduledTransactionId: string | null): Promise<ScheduleSignResult>;
  /** Deletes a pending schedule (human rejection): the vault never releases the funds. */
  deleteSchedule(scheduleId: string): Promise<{ status: string }>;
  fetchSchedule(scheduleId: string): Promise<ScheduleInfo | null>;
  /** Independent read-back (Mirror Node for testnet). Returns null when not (yet) available. */
  fetchTopicMessage(sequenceNumber: number): Promise<LedgerMessage | null>;
  /** All topic messages from a consensus time onwards (Mirror Node listing). Used to detect deleted local history. */
  listTopicMessages(sinceIso: string | null): Promise<LedgerMessage[]>;
  fetchTransaction(transactionId: string): Promise<LedgerTransaction | null>;
  hashscanTransactionUrl(transactionId: string | null, consensusTimestamp?: string | null): string | null;
  hashscanTopicUrl(): string | null;
  hashscanScheduleUrl(scheduleId: string | null): string | null;
  hashscanAccountUrl(accountId: string | null): string | null;
  hashscanTokenUrl(tokenId: string | null): string | null;
}

export class LedgerError extends Error {
  constructor(message: string, public readonly retryable = true) {
    super(message);
    this.name = "LedgerError";
  }
}
