import type { AuditEvent, MissionState } from "@eljoker/shared";
import { AGENTS } from "@/lib/agents";
import { cx, shortHash, time } from "@/lib/format";
import { Avatar, Chip, ExtLink } from "./ui";

const EVENT_TONE: Record<string, string> = {
  GUARDIAN_BLOCKED: "border-tn-red",
  SUPPLIER_REJECTED: "border-tn-red",
  PAYMENT_BLOCKED: "border-tn-red",
  PAYMENT_FAILED: "border-tn-red",
  TAMPER_DETECTED: "border-tn-red",
  HUMAN_REJECTED: "border-tn-red",
  HUMAN_REVIEW_REQUIRED: "border-amber",
  PAYMENT_CONFIRMED: "border-mint",
  GUARDIAN_APPROVED: "border-mint",
  HUMAN_APPROVED: "border-mint",
  SUPPLIER_VERIFIED: "border-mint",
};

function anchorLabel(e: AuditEvent) {
  return e.anchor.status === "ANCHORED" ? "ON HEDERA" : e.anchor.status === "SIMULATED" ? "SIMULATED LEDGER" : e.anchor.status;
}

export function AuditTimeline({ state }: { state: MissionState }) {
  const verif = new Map((state.lastVerification?.events ?? []).map((v) => [v.eventId, v]));
  if (state.auditEvents.length === 0) return <p className="p-6 text-sm text-ink-400">No audit events yet.</p>;
  return (
    <ol className="relative grid gap-3 p-4 pl-8">
      <span className="absolute top-6 bottom-6 left-[27px] w-px bg-ink-700" aria-hidden />
      {state.auditEvents.map((e) => {
        const v = verif.get(e.eventId);
        return (
          <li key={e.eventId} className={cx("relative animate-rise rounded-xl border-l-4 bg-ink-850 p-3 ring-1 ring-ink-700", EVENT_TONE[e.eventType] ?? "border-sidi")}>
            <span className="absolute top-3 -left-[26px]">
              <Avatar agent={e.agent} size={24} />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-ink-400">#{e.sequence}</span>
              <span className="font-display text-[13px] font-bold tracking-wide">{e.eventType}</span>
              <span className="text-[11px]" style={{ color: AGENTS[e.agent].color }}>{AGENTS[e.agent].name}</span>
              <span className="text-[11px] text-ink-400">{time(e.timestamp)}</span>
              <span className="ml-auto flex items-center gap-1.5">
                <Chip label={anchorLabel(e)} />
                {v && <Chip label={v.status === "SIMULATED_VALID" ? "VALID · SIMULATED" : v.status} />}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ink-300">{e.summary}</p>
            <div className="mt-2 grid gap-x-4 gap-y-0.5 text-[11px] text-ink-400 sm:grid-cols-2">
              <span>evidence <span className="hash text-ink-300">{shortHash(e.evidenceHash, 14)}</span></span>
              <span>prev <span className="hash text-ink-300">{shortHash(e.previousEventHash, 14)}</span></span>
              {e.anchor.topicId && e.anchor.sequenceNumber != null && (
                <span>topic {e.anchor.topicId} · seq {e.anchor.sequenceNumber}</span>
              )}
              {e.anchor.consensusTimestamp && <span>consensus {e.anchor.consensusTimestamp}</span>}
              {e.anchor.error && <span className="text-[#ff5c6a]">{e.anchor.error}</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]">
              {e.anchor.hashscanUrl && <ExtLink href={e.anchor.hashscanUrl}>HashScan</ExtLink>}
              <details className="text-ink-400">
                <summary className="cursor-pointer text-[11px]">off-chain evidence</summary>
                <pre className="scroll-thin mt-1 max-h-48 overflow-auto rounded bg-ink-950 p-2 text-[10.5px] text-ink-300">{JSON.stringify(e.payload, null, 2)}</pre>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
