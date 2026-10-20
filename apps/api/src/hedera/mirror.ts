import { logger } from "../logger";
import type { LedgerMessage, LedgerTransaction, ScheduleInfo } from "./gateway";

/** "0.0.123@1700000000.123456789" -> "0.0.123-1700000000-123456789" (Mirror Node / HashScan path format). */
export function toMirrorTxId(txId: string): string {
  // Scheduled transactions share their creator's id plus a "?scheduled" flag (the Mirror Node takes it as a query).
  const [account, ts] = txId.replace(/\?scheduled$/, "").split("@");
  if (!account || !ts) return txId;
  return `${account}-${ts.replace(".", "-")}`;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class MirrorNodeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = 8000,
  ) {}

  private async getJson(path: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (res.status === 404) return null; // not indexed yet (or does not exist)
      if (!res.ok) throw new Error(`Mirror Node HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async getTopicMessage(topicId: string, sequenceNumber: number): Promise<LedgerMessage | null> {
    const body = (await this.getJson(`/api/v1/topics/${topicId}/messages/${sequenceNumber}`)) as
      | { message?: string; consensus_timestamp?: string; sequence_number?: number; topic_id?: string }
      | null;
    if (!body || typeof body.message !== "string") return null;
    return {
      source: "MIRROR_NODE",
      topicId: body.topic_id ?? topicId,
      sequenceNumber: body.sequence_number ?? sequenceNumber,
      consensusTimestamp: body.consensus_timestamp ?? null,
      message: Buffer.from(body.message, "base64").toString("utf8"),
    };
  }

  /** Paginated listing of a topic's messages (oldest first), optionally from a consensus time. */
  async listTopicMessages(topicId: string, sinceIso: string | null, maxPages = 30): Promise<LedgerMessage[]> {
    const since = sinceIso ? `&timestamp=gte:${(new Date(sinceIso).getTime() / 1000).toFixed(9)}` : "";
    let path: string | null = `/api/v1/topics/${topicId}/messages?limit=100&order=asc${since}`;
    const out: LedgerMessage[] = [];
    for (let page = 0; path && page < maxPages; page++) {
      const body = (await this.getJson(path)) as {
        messages?: { message?: string; consensus_timestamp?: string; sequence_number?: number; topic_id?: string }[];
        links?: { next?: string | null };
      } | null;
      if (!body) break;
      for (const m of body.messages ?? []) {
        if (typeof m.message !== "string" || m.sequence_number == null) continue;
        out.push({ source: "MIRROR_NODE", topicId: m.topic_id ?? topicId, sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp ?? null, message: Buffer.from(m.message, "base64").toString("utf8") });
      }
      path = body.links?.next ?? null;
    }
    return out;
  }

  async getTransaction(transactionId: string): Promise<LedgerTransaction | null> {
    const scheduled = transactionId.endsWith("?scheduled") ? "?scheduled=true" : "";
    const body = (await this.getJson(`/api/v1/transactions/${toMirrorTxId(transactionId)}${scheduled}`)) as
      | { transactions?: { result?: string; consensus_timestamp?: string; transaction_id?: string }[] }
      | null;
    const tx = body?.transactions?.[0];
    if (!tx) return null;
    return { transactionId, result: tx.result ?? "UNKNOWN", consensusTimestamp: tx.consensus_timestamp ?? null };
  }

  async getSchedule(scheduleId: string): Promise<ScheduleInfo | null> {
    const body = (await this.getJson(`/api/v1/schedules/${scheduleId}`)) as
      | { schedule_id?: string; executed_timestamp?: string | null; deleted?: boolean; signatures?: unknown[] }
      | null;
    if (!body?.schedule_id) return null;
    return { scheduleId, executed: !!body.executed_timestamp, deleted: !!body.deleted, signatures: Array.isArray(body.signatures) ? body.signatures.length : 0, executedTimestamp: body.executed_timestamp ?? null };
  }

  async getAccountKey(accountId: string): Promise<{ type: string; key: string } | null> {
    try {
      const body = (await this.getJson(`/api/v1/accounts/${accountId}`)) as { key?: { _type?: string; key?: string } } | null;
      if (!body?.key?._type || !body.key.key) return null;
      return { type: body.key._type, key: body.key.key };
    } catch (e) {
      logger.warn("mirror.account_lookup_failed", { accountId, error: e });
      return null;
    }
  }
}
