"use client";
import type { MissionState, PublicConfig } from "@eljoker/shared";
import { useEffect, useRef } from "react";
import { AGENTS } from "@/lib/agents";
import { cx, shortHash, time } from "@/lib/format";
import { Avatar, Chip, ExtLink, Panel } from "./ui";

const LABEL: Record<string, string> = {
  MISSION_CREATED: "Mission created",
  AI_RECOMMENDATION: "AI recommendation",
  SUPPLIER_VERIFIED: "Supplier verified",
  SUPPLIER_REJECTED: "Supplier rejected",
  GUARDIAN_APPROVED: "Guardian approved",
  GUARDIAN_BLOCKED: "Guardian blocked",
  HUMAN_REVIEW_REQUIRED: "Human review required",
  HUMAN_APPROVED: "Human approved",
  HUMAN_REJECTED: "Human rejected",
  PAYMENT_INITIATED: "Payment initiated",
  PAYMENT_CONFIRMED: "Payment confirmed",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_BLOCKED: "Payment blocked",
  TAMPER_DETECTED: "Tampering detected",
};
const BAD = /BLOCKED|REJECTED|FAILED|TAMPER/;

/** Live stream of decisions being written to Hedera (HCS), newest last. */
export function ProofFeed({ state, config }: { state: MissionState; config: PublicConfig | null }) {
  const box = useRef<HTMLDivElement>(null);
  const live = config?.hedera.mode === "LIVE_TESTNET";
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [state.auditEvents.length]);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan" />
          </span>
          Live Hedera proofs
        </span>
      }
      right={<Chip label={live ? `HCS · ${config?.hedera.topicId}` : "Simulated ledger"} tone={live ? "green" : "amber"} />}
    >
      <div ref={box} className="scroll-thin max-h-[440px] overflow-y-auto px-4 py-4">
        {state.auditEvents.length === 0 && <p className="px-2 py-6 text-center text-sm text-ink-400">Waiting for the first decision…</p>}
        <ol className="grid gap-2.5">
          {state.auditEvents.map((e) => {
            const pending = e.anchor.status === "PENDING";
            return (
              <li key={e.eventId} className={cx("animate-rise rounded-2xl border px-4 py-3", BAD.test(e.eventType) ? "border-tn-red/40 bg-tn-red/[0.07]" : "border-white/[0.07] bg-white/[0.025]")}>
                <div className="flex items-center gap-3">
                  <Avatar agent={e.agent} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className={cx("truncate text-[14px] font-semibold", BAD.test(e.eventType) ? "text-[#ff8a94]" : "text-white")}>{LABEL[e.eventType] ?? e.eventType}</div>
                    <div className="text-[11.5px] text-ink-400">
                      {AGENTS[e.agent].name} · {time(e.timestamp)}
                      {e.anchor.sequenceNumber != null && ` · seq #${e.anchor.sequenceNumber}`}
                    </div>
                  </div>
                  {pending ? (
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#b9b2ff]">
                      <span className="h-2 w-2 animate-ping rounded-full bg-indigo" /> consensus…
                    </span>
                  ) : (
                    <Chip label={e.anchor.status === "ANCHORED" ? "on Hedera" : e.anchor.status === "SIMULATED" ? "simulated" : e.anchor.status} />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-[42px]">
                  <span className="hash text-ink-400">sha256 {shortHash(e.evidenceHash, 12)}</span>
                  {e.anchor.hashscanUrl && <ExtLink href={e.anchor.hashscanUrl}>HashScan</ExtLink>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
