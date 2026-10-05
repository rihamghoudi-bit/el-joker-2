import type { MissionState, PublicConfig } from "@eljoker/shared";
import type { ReactNode } from "react";
import { AGENTS } from "@/lib/agents";
import { usd } from "@/lib/format";
import { Chip, ExtLink, Panel } from "./ui";

const MISSION_CHIP: Record<string, string> = {
  NEEDS_INFORMATION: "NEEDS INFORMATION",
  CREATED: "CREATED",
  RESEARCHING: "AI ANALYZING",
  VERIFYING: "VERIFYING",
  EVALUATING: "EVALUATING",
  HUMAN_REVIEW: "HUMAN REVIEW",
  APPROVED: "APPROVED",
  PAYING: "PAYING",
  PAID: "PAID",
  BLOCKED: "BLOCKED",
  REJECTED: "REJECTED",
  PAYMENT_FAILED: "PAYMENT FAILED",
  FAILED: "ERROR",
};

export const missionChip = (status: string) => MISSION_CHIP[status] ?? status;

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-start gap-2 border-b border-ink-700/50 px-4 py-2 last:border-0">
      <dt className="pt-0.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">{k}</dt>
      <dd className="min-w-0 text-[13px] text-ink-100">{children}</dd>
    </div>
  );
}

export function StatusBoard({ state, config }: { state: MissionState; config: PublicConfig | null }) {
  const { mission, recommendation, verification, guardianDecision: g } = state;
  const offer = state.offers.find((o) => o.offerId === recommendation?.recommendedOfferId) ?? null;
  const supplier = offer ? state.suppliers.find((s) => s.supplierId === offer.supplierId) : null;
  const lemhaf = state.agentRuns.find((r) => r.agent === "LEMHAF");
  const payment = state.payments.find((p) => p.status !== "FAILED") ?? state.payments[0] ?? null;
  const approval = state.approvals[0] ?? null;
  const anchored = state.auditEvents.filter((e) => e.anchor.status === "ANCHORED").length;
  const simulated = state.auditEvents.filter((e) => e.anchor.status === "SIMULATED").length;
  const failed = state.auditEvents.filter((e) => e.anchor.status === "FAILED").length;
  const pending = state.auditEvents.filter((e) => e.anchor.status === "PENDING").length;
  const lv = state.lastVerification;

  return (
    <Panel title="Mission status" right={<Chip label={missionChip(mission.status)} />}>
      <dl>
        <Row k="Mission">
          <span className="line-clamp-2">{mission.description}</span>
          {mission.isDemo && <Chip label="Demo scenario" tone="gold" className="mt-1" />}
        </Row>
        <Row k="Budget">{usd(mission.maximumBudget)} <span className="text-ink-400">· {mission.beneficiaries.toLocaleString("en-US")} people</span></Row>
        <Row k="Region">{mission.location} <span className="text-ink-400">· urgency {mission.urgency}</span></Row>
        <Row k="Supplier">
          {supplier ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {supplier.name} <Chip label={supplier.verified ? "VERIFIED" : "UNVERIFIED"} />
            </span>
          ) : (
            "—"
          )}
        </Row>
        <Row k="Offer">{offer ? <>{usd(offer.totalPrice)} <span className="text-ink-400">· {offer.deliveryTimeHours}h · {offer.invoiceId}</span></> : "—"}</Row>
        <Row k="Current agent">{state.currentAgent ? <span style={{ color: AGENTS[state.currentAgent].color }} className="font-semibold">{AGENTS[state.currentAgent].glyph} {AGENTS[state.currentAgent].name}</span> : <span className="text-ink-400">idle</span>}</Row>
        <Row k="AI mode">
          {lemhaf ? (
            <span className="flex flex-col gap-1">
              <Chip label={lemhaf.mode === "REAL_AI" ? `REAL AI · ${lemhaf.model}` : lemhaf.mode} />
              {lemhaf.fallbackReason && <span className="text-[11px] text-amber">Fallback: {lemhaf.fallbackReason}</span>}
            </span>
          ) : (
            <span className="text-ink-400">{config?.ai.configured ? "Claude ready" : "Fallback (no key)"}</span>
          )}
        </Row>
        <Row k="Verification">{verification ? <Chip label={verification.status.replace("_", " ")} /> : "—"}</Row>
        <Row k="Risk level">{g ? <span className="flex items-center gap-2"><Chip label={`RISK ${g.riskLevel}`} /> <span className="text-[11px] text-ink-400">score {g.riskScore}</span></span> : "—"}</Row>
        <Row k="Guardian">{g ? <Chip label={g.decision === "HUMAN_REVIEW_REQUIRED" ? "HUMAN REVIEW" : g.decision} /> : "—"}</Row>
        <Row k="Human approval">
          {approval ? (
            <span>
              <Chip label={approval.decision === "APPROVED" ? "HUMAN APPROVED" : "HUMAN REJECTED"} /> <span className="text-[11px] text-ink-400">by {approval.actorId}</span>
            </span>
          ) : mission.status === "HUMAN_REVIEW" ? (
            <Chip label="WAITING FOR OPERATOR" tone="amber" />
          ) : (
            <span className="text-ink-400">not required</span>
          )}
        </Row>
        <Row k="Payment">
          {payment ? (
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <Chip label={payment.status === "CONFIRMED" ? (payment.mode === "SIMULATED" ? "PAID · SIMULATED" : "PAID") : payment.status} />
                <span className="text-[11px] text-ink-400">{payment.settlementAmount} ℏ demo settlement</span>
              </span>
              <ExtLink href={payment.hashscanUrl}>HashScan transaction</ExtLink>
              {payment.error && <span className="text-[11px] text-[#ff5c6a]">{payment.error}</span>}
            </span>
          ) : ["BLOCKED", "REJECTED"].includes(mission.status) ? (
            <Chip label="NO PAYMENT" tone="red" />
          ) : (
            <span className="text-ink-400">not executed</span>
          )}
        </Row>
        <Row k="Hedera proof">
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap gap-1.5">
              {anchored > 0 && <Chip label={`${anchored} ANCHORED`} tone="green" />}
              {simulated > 0 && <Chip label={`${simulated} SIMULATED`} tone="amber" />}
              {pending > 0 && <Chip label={`${pending} PENDING`} tone="blue" />}
              {failed > 0 && <Chip label={`${failed} FAILED`} tone="red" />}
              {state.auditEvents.length === 0 && <span className="text-ink-400">—</span>}
            </span>
            {lv && <Chip label={lv.overall === "VALID" ? "PROOF VERIFIED" : lv.overall === "TAMPERING_DETECTED" ? "TAMPERING DETECTED" : lv.overall} />}
          </span>
        </Row>
      </dl>
    </Panel>
  );
}
