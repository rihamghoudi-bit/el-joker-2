import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  Status,
  TopicId,
  TopicMessageSubmitTransaction,
  TransactionReceiptQuery,
  TransferTransaction,
  type TransactionId,
} from "@hashgraph/sdk";
import { logger } from "../logger";
import { type LedgerGateway, LedgerError, type LedgerMessage, type LedgerTransaction, type SubmitResult, type TransferResult } from "./gateway";
import { MirrorNodeClient, toMirrorTxId } from "./mirror";

export interface HederaSdkOptions {
  accountId: string;
  privateKey: string;
  topicId: string;
  payeeAccountId: string | null;
  mirrorNodeUrl: string;
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
  if (out.length === 0) throw new Error("HEDERA_PRIVATE_KEY could not be parsed (expected DER or 64-char hex)");
  return out;
}

/** Real Hedera TESTNET gateway. Mainnet is impossible: the client is built with Client.forTestnet(). */
export class HederaSdkGateway implements LedgerGateway {
  readonly mode = "LIVE_TESTNET" as const;
  readonly topicId: string;
  readonly payeeAccountId: string | null;
  private client: Client;
  private operator: AccountId;
  readonly mirror: MirrorNodeClient;
  private keyCandidates: PrivateKey[];

  constructor(opts: HederaSdkOptions) {
    this.topicId = opts.topicId;
    this.payeeAccountId = opts.payeeAccountId;
    this.operator = AccountId.fromString(opts.accountId);
    this.keyCandidates = privateKeyCandidates(opts.privateKey);
    this.client = Client.forTestnet();
    this.client.setOperator(this.operator, this.keyCandidates[0]!);
    this.mirror = new MirrorNodeClient(opts.mirrorNodeUrl);
  }

  /** For raw-hex keys, pick the curve whose public key matches the account's key on the Mirror Node. */
  async init(): Promise<void> {
    if (this.keyCandidates.length < 2) return;
    const accountKey = await this.mirror.getAccountKey(this.operator.toString());
    if (!accountKey) return;
    const match = this.keyCandidates.find((k) => accountKey.key.toLowerCase().endsWith(k.publicKey.toStringRaw().toLowerCase()));
    if (match) {
      this.client.setOperator(this.operator, match);
      logger.info("hedera.operator_key_detected", { type: accountKey.type });
    } else {
      logger.warn("hedera.operator_key_mismatch", { accountType: accountKey.type });
    }
  }

  close() {
    this.client.close();
  }

  async submitMessage(message: string): Promise<SubmitResult> {
    try {
      const response = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(this.topicId)).setMessage(message).execute(this.client);
      let receipt;
      try {
        receipt = await response.getReceipt(this.client);
      } catch (receiptErr) {
        // The message may already be on the ledger: ask again for the receipt of the SAME transaction
        // instead of publishing a duplicate copy.
        logger.warn("hedera.hcs_receipt_retry", { txId: response.transactionId.toString(), error: receiptErr });
        receipt = await new TransactionReceiptQuery().setTransactionId(response.transactionId).execute(this.client);
      }
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

  /**
   * Single-shot transfer. We never re-sign a NEW transaction on failure (that could pay twice).
   * If the receipt fetch fails, we re-query the receipt of the SAME transaction id.
   */
  async transferHbar({ to, amountHbar, memo }: { to: string; amountHbar: number; memo: string }): Promise<TransferResult> {
    const tx = new TransferTransaction()
      .addHbarTransfer(this.operator, new Hbar(-amountHbar))
      .addHbarTransfer(AccountId.fromString(to), new Hbar(amountHbar))
      .setTransactionMemo(memo.slice(0, 100))
      .freezeWith(this.client);
    const txId: TransactionId | null = tx.transactionId;
    let status: Status;
    try {
      const response = await tx.execute(this.client);
      try {
        status = (await response.getReceipt(this.client)).status;
      } catch (receiptErr) {
        logger.warn("hedera.transfer_receipt_retry", { txId: txId?.toString(), error: receiptErr });
        status = (await new TransactionReceiptQuery().setTransactionId(response.transactionId).execute(this.client)).status;
      }
    } catch (e) {
      throw new LedgerError(`Transfer failed: ${e instanceof Error ? e.message : String(e)}`, false);
    }
    return { transactionId: txId?.toString() ?? null, status: status.toString(), consensusTimestamp: null };
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
}
