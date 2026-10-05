"use client";
import type { FeedMessage, GuardianDecision, MissionState, Recommendation, VerificationResult } from "@eljoker/shared";
import { useEffect, useRef } from "react";
import { AGENTS } from "@/lib/agents";
import { cx, time, usd } from "@/lib/format";
import { Avatar, Chip, ExtLink } from "./ui";

function CheckList({ items }: { items: { label: string; ok: boolean | "review"; detail: string }[] }) {
  return (
    <ul className="mt-2 grid gap-1">
      {items.map((c, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px]">
          <span className={cx("mt-px w-4 shrink-0 text-center font-bold", c.ok === true ? "text-mint" : c.ok === "review" ? "text-amber" : "text-[#ff5c6a]")}>{c.ok === true ? "✓" : c.ok === "review" ? "!" : "✕"}</span>
          <span className="min-w-0">
            <span className="font-semibold text-ink-100">{c.label}</span> <span className="text-ink-400">— {c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Details({ msg, state }: { msg: FeedMessage; state: MissionState }) {
  const d = msg.data ?? {};
  if (d.recommendation) {
    const rec = d.recommendation as Recommendation;
    return (
      <details className="mt-2 rounded-lg bg-ink-950/50 p-2 text-[12px]">
        <summary className="cursor-pointer text-ink-300">Ranking of {rec.ranking.length} offers{d.fallbackReason ? ` · fallback reason: ${String(d.fallbackReason)}` : ""}</summary>
        <ol className="mt-2 grid gap-1">
          {rec.ranking.map((r) => (
            <li key={r.offerId} className="flex gap-2">
              <span className="w-5 font-bold text-violet">#{r.rank}</span>
              <span className="w-8 text-ink-400">{Math.round(r.score)}</span>
              <span className="text-ink-300">{r.rationale}</span>
            </li>
          ))}
        </ol>
        {rec.concerns.length > 0 && <p className="mt-2 text-amber">Concerns: {rec.concerns.join(" · ")}</p>}
      </details>
    );
  }
  if (d.verification) {
    const v = d.verification as VerificationResult;
    return <CheckList items={v.checks.map((c) => ({ label: c.label, ok: c.passed ? true : c.severity === "REVIEW" ? "review" : false, detail: c.detail }))} />;
  }
  if (d.decision) {
    const g = d.decision as GuardianDecision;
    return (
      <>
        <CheckList items={g.checks.map((c) => ({ label: c.label, ok: c.outcome === "PASS" ? true : c.outcome === "REVIEW" ? "review" : false, detail: c.detail }))} />
        <p className="mt-2 text-[11px] text-ink-400">
          Policy {g.policyVersion} · risk score {g.riskScore}{g.riskFactors.length ? ` (${g.riskFactors.join("; ")})` : ""} · input hash <span className="hash">{g.inputHash.slice(0, 16)}…</span>
        </p>
      </>
    );
  }
  if (Array.isArray(d.reasons)) {
    return (
      <ul className="mt-2 list-disc pl-5 text-[12px] text-ink-300">
        {(d.reasons as string[]).map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(d.missingFields)) {
    return <p className="mt-1 text-[12px] text-amber">Please provide: {(d.missingFields as string[]).join(", ")}</p>;
  }
  if (d.paymentId) {
    const p = state.payments.find((x) => x.paymentId === d.paymentId);
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
        {p?.hederaTransactionId && <span className="hash text-ink-300">tx {p.hederaTransactionId}</span>}
        <ExtLink href={p?.hashscanUrl}>View on HashScan</ExtLink>
        {p?.mirrorVerified && <Chip label="Mirror Node confirmed" tone="green" />}
      </div>
    );
  }
  return null;
}

export function ChatFeed({ state }: { state: MissionState }) {
  const box = useRef<HTMLDivElement>(null);
  const count = state.feed.length;
  useEffect(() => {
    // Scroll only the chat pane (never the page) to the newest message.
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, state.currentAgent]);

  return (
    <div ref={box} className="scroll-thin h-full overflow-y-auto">
    <div className="grid gap-3 p-4">
      {state.feed.map((m) => {
        const a = AGENTS[m.agent];
        const isOperator = m.agent === "OPERATOR";
        return (
          <div key={m.id} className={cx("flex animate-rise gap-3", isOperator && "flex-row-reverse")}>
            <Avatar agent={m.agent} size={38} />
            <div className={cx("max-w-[88%] min-w-0", isOperator && "text-right")}>
              <div className={cx("mb-1 flex flex-wrap items-center gap-2", isOperator && "justify-end")}>
                <span className="text-[13px] font-bold" style={{ color: a.color }}>{a.name}</span>
                <span className="text-[10.5px] text-ink-400 uppercase">{a.role}</span>
                <span className="text-[10.5px] text-ink-600">{time(m.createdAt)}</span>
              </div>
              <div
                className={cx(
                  "rounded-2xl border px-3.5 py-2.5 text-left text-[13.5px] leading-relaxed",
                  isOperator ? "rounded-tr-sm" : "rounded-tl-sm",
                  m.kind === "alert" ? "border-tn-red/40 bg-tn-red/10" : m.kind === "success" ? "border-mint/30 bg-mint/[0.07]" : m.kind === "proof" ? "border-sidi/40 bg-sidi/10" : m.kind === "working" ? "border-ink-700 bg-ink-850 text-ink-300 italic" : "border-ink-700 bg-ink-850",
                )}
              >
                {m.text}
                <Details msg={m} state={state} />
                {m.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.chips.map((c) => (
                      <Chip key={c} label={c} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {state.currentAgent && (
        <div className="flex items-center gap-3 text-[12px] text-ink-400">
          <Avatar agent={state.currentAgent} size={28} active />
          <span>
            <b style={{ color: AGENTS[state.currentAgent].color }}>{AGENTS[state.currentAgent].name}</b> is working
            <span className="ml-1 inline-flex gap-0.5">
              <span className="animate-blink">•</span>
              <span className="animate-blink [animation-delay:0.2s]">•</span>
              <span className="animate-blink [animation-delay:0.4s]">•</span>
            </span>
          </span>
        </div>
      )}
      {state.mission.status === "PAID" && state.payments[0] && (
        <p className="text-center text-[11px] text-ink-400">Settlement is a scaled demo amount ({state.payments[0].settlementAmount} ℏ) representing the {usd(state.payments[0].amount)} offer.</p>
      )}
    </div>
    </div>
  );
}
