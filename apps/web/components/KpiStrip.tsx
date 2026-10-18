import { isLivePayment, type MissionState, ORGANIZATIONS, organizationOf } from "@eljoker/shared";
import type { ReactNode } from "react";
import { cx, usd } from "@/lib/format";
import { ExtLink } from "./ui";

type Tone = "neutral" | "good" | "bad" | "warn" | "busy";
const TONE: Record<Tone, string> = {
  neutral: "text-white",
  good: "text-mint",
  bad: "text-[#ff5c6a]",
  warn: "text-amber",
  busy: "text-[#a59cff]",
};
const BAR: Record<Tone, string> = {
  neutral: "bg-ink-600",
  good: "bg-mint",
  bad: "bg-tn-red",
  warn: "bg-amber",
  busy: "bg-indigo",
};

function Kpi({ label, value, sub, tone = "neutral" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="glass relative overflow-hidden rounded-3xl px-5 py-5">
      <span className={cx("absolute inset-x-0 top-0 h-1", BAR[tone])} />
      <div className="text-[11px] font-semibold tracking-[0.16em] text-ink-400 uppercase">{label}</div>
      <div className={cx("mt-2 font-display text-2xl leading-tight font-bold", TONE[tone])}>{value}</div>
      {sub && <div className="mt-1.5 text-[13px] leading-snug text-ink-400">{sub}</div>}
    </div>
  );
}

export function KpiStrip({ state, className }: { state: MissionState; className?: string }) {
  const { mission, guardianDecision: g, verification } = state;
  const offer = state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId) ?? null;
  const supplier = offer ? state.suppliers.find((s) => s.supplierId === offer.supplierId) : null;
  const payment = state.payments.find(isLivePayment) ?? state.payments.find((p) => p.status === "SCHEDULED") ?? state.payments[0] ?? null;
  const org = ORGANIZATIONS[organizationOf(mission)];
  const amount = payment ? (payment.settlementCurrency === "HBAR" ? `${payment.settlementAmount} ℏ` : `${payment.settlementAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${payment.settlementCurrency}`) : "";
  const anchored = state.auditEvents.filter((e) => e.anchor.status === "ANCHORED" || e.anchor.status === "SIMULATED").length;
  const pending = state.auditEvents.filter((e) => e.anchor.status === "PENDING").length;
  const lv = state.lastVerification;
  const simulated = state.auditEvents.some((e) => e.anchor.status === "SIMULATED");

  const decision = g?.decision === "HUMAN_REVIEW_REQUIRED" ? "Human review" : g?.decision === "APPROVED" ? "Approved" : g?.decision === "BLOCKED" ? "Blocked" : "—";
  const decisionTone: Tone = g?.decision === "APPROVED" ? "good" : g?.decision === "BLOCKED" ? "bad" : g ? "warn" : state.currentAgent === "3ASES" ? "busy" : "neutral";

  const payValue = payment?.status === "CONFIRMED" ? "Paid" : payment?.status === "SCHEDULED" ? "Locked in vault" : payment?.status === "FAILED" ? "Failed" : ["BLOCKED", "REJECTED"].includes(mission.status) ? "No payment" : mission.status === "HUMAN_REVIEW" ? "On hold" : mission.status === "PAYING" ? "Paying…" : "—";
  const payTone: Tone = payment?.status === "CONFIRMED" ? "good" : payment?.status === "SCHEDULED" ? "warn" : payment?.status === "FAILED" || ["BLOCKED", "REJECTED"].includes(mission.status) ? "bad" : mission.status === "HUMAN_REVIEW" ? "warn" : mission.status === "PAYING" ? "busy" : "neutral";

  const proofValue = lv?.overall === "TAMPERING_DETECTED" ? "Tampered" : lv?.overall === "VALID" ? "Verified" : `${anchored}/${state.auditEvents.length}`;
  const proofTone: Tone = lv?.overall === "TAMPERING_DETECTED" ? "bad" : lv?.overall === "VALID" ? "good" : pending ? "busy" : anchored ? "good" : "neutral";

  return (
    <div className={className ?? "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"}>
      <Kpi label="Budget" value={usd(mission.maximumBudget)} sub={`${mission.beneficiaries.toLocaleString("en-US")} ${org.peopleLabel} · ${mission.location} · ${org.shortName}`} />
      <Kpi
        label="Best offer"
        value={offer ? usd(offer.totalPrice) : state.currentAgent === "LEMHAF" ? "Searching…" : "—"}
        tone={offer ? (offer.totalPrice > mission.maximumBudget ? "bad" : "neutral") : state.currentAgent === "LEMHAF" ? "busy" : "neutral"}
        sub={supplier ? `${supplier.name.replace(" (demo)", "")} · ${supplier.verified ? "verified" : "UNVERIFIED"}` : undefined}
      />
      <Kpi
        label="Verification"
        value={verification ? verification.status.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : state.currentAgent === "NASNES" ? "Checking…" : "—"}
        tone={verification?.status === "VERIFIED" ? "good" : verification?.status === "REJECTED" ? "bad" : verification ? "warn" : state.currentAgent === "NASNES" ? "busy" : "neutral"}
        sub={verification ? `${verification.checks.filter((c) => c.passed).length}/${verification.checks.length} checks passed` : "Nasnes · independent"}
      />
      <Kpi label="Guardian" value={decision} tone={decisionTone} sub={g ? `Risk ${g.riskLevel} · no LLM` : "3ases · deterministic"} />
      <Kpi label="Payment" value={payValue} tone={payTone} sub={payment ? <span className="flex flex-wrap gap-x-2">{amount} {payment.mode === "SIMULATED" ? "· simulated" : "· testnet"}{payment.source === "VAULT" ? " · vault 2-of-2" : ""} <ExtLink href={payment.hashscanUrl}>HashScan</ExtLink> <ExtLink href={payment.scheduleHashscanUrl}>schedule</ExtLink></span> : "Kanawita"} />
      <Kpi label="Hedera proof" value={proofValue} tone={proofTone} sub={lv ? (lv.overall === "VALID" ? "matches consensus record" : lv.summary.slice(0, 60)) : `events anchored${simulated ? " · simulated" : ""}`} />
    </div>
  );
}
