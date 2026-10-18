import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  ScheduleId,
  ScheduleInfoQuery,
  ScheduleSignTransaction,
  Status,
  TokenId,
  TopicId,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransactionReceiptQuery,
  type TransactionReceipt,
  type TransactionResponse,
  TransferTransaction,
} from "@hashgraph/sdk";
import { logger } from "../logger";
import {
  type LedgerGateway,
  LedgerError,
  type LedgerMessage,
  type LedgerTransaction,
  type ScheduleInfo,
  type ScheduleResult,
  type ScheduleSignResult,
  type SettlementAsset,
  type SubmitResult,
  type TransferResult,
} from "./gateway";
import { MirrorNodeClient, toMirrorTxId } from "./mirror";

export interface HederaSdkOptions {
  accountId: string;
  privateKey: string;
  topicId: string;
  payeeAccountId: string | null;
  mirrorNodeUrl: string;
  /** 2-of-2 vault account and the approver's key (demo: held by the server, released only after operator + PIN). */
  vaultAccountId?: string | null;
  approverPrivateKey?: string | null;
  stablecoin?: { tokenId: string; symbol: string; decimals: number } | null;
}

const HASHSCAN = "https://hashscan.io/testnet";

/** Parse DER (ED25519/ECDSA) or raw hex keys. Raw hex is ambiguous, so both curves are returned as candidates. */
export function privateKeyCandidates(raw: string): PrivateKey[] {
  const s = raw.trim();
  const hex = s.replace(/^0x/i, "");
  if (/^30[0-9a-f]+$/i.test(hex) && hex.length > 64) return [PrivateKey.fromStringDer(hex)];
  const out: PrivateKey[] = [];
  for (const parse of [PrivateKey.fromStringECDSA, PrivateKey.fromStringED25519]) {
    try {
      out.push(parse(hex));
    } catch {
      /* not this curve */
    }
  }
  if (out.length === 0) throw new Error("Hedera private key could not be parsed (expected DER or 64-char hex)");
  return out;
}

/** Real Hedera TESTNET gateway. Mainnet is impossible: the client is built with Client.forTestnet(). */
export class HederaSdkGateway implements LedgerGateway {
  readonly mode = "LIVE_TESTNET" as const;
  readonly topicId: string;
  readonly payeeAccountId: string | null;
  readonly settlement: SettlementAsset;
  readonly vault: { enabled: boolean; accountId: string | null };
  private client: Client;
  private operator: AccountId;
  private operatorKey: PrivateKey;
  private approverKey: PrivateKey | null;
  readonly mirror: MirrorNodeClient;
  private keyCandidates: PrivateKey[];

  constructor(opts: HederaSdkOptions) {
    this.topicId = opts.topicId;
    this.payeeAccountId = opts.payeeAccountId;
    this.operator = AccountId.fromString(opts.accountId);
    this.keyCandidates = privateKeyCandidates(opts.privateKey);
    this.operatorKey = this.keyCandidates[0]!;
    this.client = Client.forTestnet();
    this.client.setOperator(this.operator, this.operatorKey);
    this.mirror = new MirrorNodeClient(opts.mirrorNodeUrl);
    this.approverKey = opts.approverPrivateKey ? privateKeyCandidates(opts.approverPrivateKey)[0]! : null;
    this.vault = { enabled: Boolean(opts.vaultAccountId && this.approverKey), accountId: opts.vaultAccountId ?? null };
    this.settlement = opts.stablecoin ? { kind: "TOKEN", symbol: opts.stablecoin.symbol, tokenId: opts.stablecoin.tokenId, decimals: opts.stablecoin.decimals } : { kind: "HBAR", symbol: "HBAR" };
  }

  /** For raw-hex keys, pick the curve whose public key matches the account's key on the Mirror Node. */
  async init(): Promise<void> {
    if (this.keyCandidates.length < 2) return;
    const accountKey = await this.mirror.getAccountKey(this.operator.toString());
    if (!accountKey) return;
    const match = this.keyCandidates.find((k) => accountKey.key.toLowerCase().endsWith(k.publicKey.toStringRaw().toLowerCase()));
    if (match) {
      this.operatorKey = match;
      this.client.setOperator(this.operator, match);
      logger.info("hedera.operator_key_detected", { type: accountKey.type });
    } else {
      logger.warn("hedera.operator_key_mismatch", { accountType: accountKey.type });
    }
  }

  close() {
    this.client.close();
  }

  /** Receipt of a submitted transaction; if fetching it fails, ask again for the SAME transaction id (never resubmit). */
  private async receiptOf(response: TransactionResponse, what: string): Promise<TransactionReceipt> {
    try {
      return await response.getReceipt(this.client);
    } catch (receiptErr) {
      // A status error is a real answer from the network (e.g. INSUFFICIENT_TOKEN_BALANCE): do not mask it.
      if (receiptErr instanceof Error && "status" in receiptErr && (receiptErr as { status?: unknown }).status instanceof Status) throw receiptErr;
      logger.warn("hedera.receipt_retry", { what, txId: response.transactionId.toString(), error: receiptErr });
      return new TransactionReceiptQuery().setTransactionId(response.transactionId).execute(this.client);
    }
  }

  async submitMessage(message: string): Promise<SubmitResult> {
    try {
      const response = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(this.topicId)).setMessage(message).execute(this.client);
      const receipt = await this.receiptOf(response, "hcs");
      if (receipt.status !== Status.Success) throw new LedgerError(`HCS submit status ${receipt.status.toString()}`);
      return {
        topicId: this.topicId,
        sequenceNumber: Number(receipt.topicSequenceNumber?.toString() ?? "0"),
        transactionId: response.transactionId.toString(),
        consensusTimestamp: null,
      };
    } catch (e) {
      throw e instanceof LedgerError ? e : new LedgerError(e instanceof Error ? e.message : String(e));
    }
  }

  /** A transfer of `amount` settlement units (HBAR or the HTS stablecoin) between two accounts. Not frozen. */
  private buildTransfer(from: AccountId, to: string, amount: number, memo: string): TransferTransaction {
    const tx = new TransferTransaction().setTransactionMemo(memo.slice(0, 100));
    const payee = AccountId.fromString(to);
    if (this.settlement.kind === "TOKEN") {
      const units = Math.round(amount * 10 ** this.settlement.decimals);
      const token = TokenId.fromString(this.settlement.tokenId);
      tx.addTokenTransfer(token, from, -units).addTokenTransfer(token, payee, units);
    } else {
      tx.addHbarTransfer(from, new Hbar(-amount)).addHbarTransfer(payee, new Hbar(amount));
    }
    return tx;
  }

  /**
   * Single-shot transfer from the agents' account. We never re-sign a NEW transaction on failure (that could pay twice).
   * If the receipt fetch fails, we re-query the receipt of the SAME transaction id.
   */
  async transfer({ to, amount, memo }: { to: string; amount: number; memo: string }): Promise<TransferResult> {
    const tx = this.buildTransfer(this.operator, to, amount, memo).freezeWith(this.client);
    const txId: TransactionId | null = tx.transactionId;
    let status: Status;
    try {
      const response = await tx.execute(this.client);
      status = (await this.receiptOf(response, "transfer")).status;
    } catch (e) {
      const s = e instanceof Error && "status" in e ? String((e as { status?: unknown }).status) : null;
      if (s) return { transactionId: txId?.toString() ?? null, status: s, consensusTimestamp: null };
      throw new LedgerError(`Transfer failed: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    return { transactionId: txId?.toString() ?? null, status: status.toString(), consensusTimestamp: null };
  }

  /**
   * Lock a vault payment on Hedera. The vault's key is a 2-of-2 threshold key (agents + approver). The ScheduleCreate is
   * signed by the agents' key, which counts as the first signature; Hedera holds the transfer until the approver signs.
   * The admin key (agents) can delete it if the human rejects.
   */
  async scheduleVaultTransfer({ to, amount, memo }: { to: string; amount: number; memo: string }): Promise<ScheduleResult> {
    if (!this.vault.enabled || !this.vault.accountId) throw new LedgerError("Vault is not configured", false);
    const inner = this.buildTransfer(AccountId.fromString(this.vault.accountId), to, amount, memo);
    try {
      const response = await new ScheduleCreateTransaction()
        .setScheduledTransaction(inner)
        .setScheduleMemo(memo.slice(0, 100))
        .setAdminKey(this.operatorKey.publicKey)
        .setPayerAccountId(this.operator)
        .execute(this.client);
      const receipt = await this.receiptOf(response, "schedule_create");
      if (receipt.status !== Status.Success || !receipt.scheduleId) throw new LedgerError(`Schedule create status ${receipt.status.toString()}`, false);
      return { scheduleId: receipt.scheduleId.toString(), transactionId: response.transactionId.toString(), scheduledTransactionId: receipt.scheduledTransactionId?.toString() ?? null };
    } catch (e) {
      throw e instanceof LedgerError ? e : new LedgerError(`Schedule create failed: ${e instanceof Error ? e.message : String(e)}`, false);
    }
  }

  /** Add the approver's signature; with 2 of 2 keys present, Hedera executes the transfer in the same consensus round. */
  async signSchedule(scheduleId: string, scheduledTransactionId: string | null): Promise<ScheduleSignResult> {
    if (!this.approverKey) throw new LedgerError("Approver key is not configured", false);
    const id = ScheduleId.fromString(scheduleId);
    let signStatus: string;
    try {
      const tx = await new ScheduleSignTransaction().setScheduleId(id).freezeWith(this.client).sign(this.approverKey);
      const response = await tx.execute(this.client);
      signStatus = (await this.receiptOf(response, "schedule_sign")).status.toString();
    } catch (e) {
      const s = e instanceof Error && "status" in e ? String((e as { status?: unknown }).status) : null;
      if (!s) throw new LedgerError(`Schedule sign failed: ${e instanceof Error ? e.message : String(e)}`, false);
      signStatus = s;
    }
    let executed = false;
    let executedStatus: string | null = null;
    try {
      const info = await new ScheduleInfoQuery().setScheduleId(id).execute(this.client);
      executed = info.executed != null;
    } catch (e) {
      logger.warn("hedera.schedule_info_failed", { scheduleId, error: e });
    }
    if (executed && scheduledTransactionId) {
      try {
        executedStatus = (await new TransactionReceiptQuery().setTransactionId(TransactionId.fromString(scheduledTransactionId)).execute(this.client)).status.toString();
      } catch (e) {
        const s = e instanceof Error && "status" in e ? String((e as { status?: unknown }).status) : null;
        executedStatus = s ?? "UNKNOWN";
      }
    }
    return { signStatus, executed, executedStatus, scheduledTransactionId };
  }

  async deleteSchedule(scheduleId: string): Promise<{ status: string }> {
    try {
      const response = await new ScheduleDeleteTransaction().setScheduleId(ScheduleId.fromString(scheduleId)).execute(this.client);
      return { status: (await this.receiptOf(response, "schedule_delete")).status.toString() };
    } catch (e) {
      const s = e instanceof Error && "status" in e ? String((e as { status?: unknown }).status) : null;
      return { status: s ?? `ERROR: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async fetchSchedule(scheduleId: string): Promise<ScheduleInfo | null> {
    return this.mirror.getSchedule(scheduleId);
  }

  async fetchTopicMessage(sequenceNumber: number): Promise<LedgerMessage | null> {
    return this.mirror.getTopicMessage(this.topicId, sequenceNumber);
  }

  async listTopicMessages(sinceIso: string | null): Promise<LedgerMessage[]> {
    return this.mirror.listTopicMessages(this.topicId, sinceIso);
  }

  async fetchTransaction(transactionId: string): Promise<LedgerTransaction | null> {
    return this.mirror.getTransaction(transactionId);
  }

  hashscanTransactionUrl(transactionId: string | null, consensusTimestamp?: string | null): string | null {
    if (consensusTimestamp) return `${HASHSCAN}/transaction/${consensusTimestamp}`;
    if (transactionId) return `${HASHSCAN}/transaction/${toMirrorTxId(transactionId)}`;
    return null;
  }

  hashscanTopicUrl(): string {
    return `${HASHSCAN}/topic/${this.topicId}`;
  }

  hashscanScheduleUrl(scheduleId: string | null): string | null {
    return scheduleId ? `${HASHSCAN}/schedule/${scheduleId}` : null;
  }

  hashscanAccountUrl(accountId: string | null): string | null {
    return accountId ? `${HASHSCAN}/account/${accountId}` : null;
  }

  hashscanTokenUrl(tokenId: string | null): string | null {
    return tokenId ? `${HASHSCAN}/token/${tokenId}` : null;
  }
}
