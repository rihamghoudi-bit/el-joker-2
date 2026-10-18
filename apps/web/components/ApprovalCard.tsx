"use client";
import { type MissionState, ORGANIZATIONS, organizationOf, type PublicConfig } from "@eljoker/shared";
import { useState } from "react";
import { usd } from "@/lib/format";
import { Button, Chip, ExtLink, Panel } from "./ui";

export function ApprovalCard({ state, config, onDecide }: { state: MissionState; config: PublicConfig | null; onDecide: (decision: "APPROVED" | "REJECTED", reason: string, actorId: string, pin: string) => Promise<void> }) {
  const operators = config?.operators ?? [];
  const [actor, setActor] = useState(operators[0] ?? "");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const g = state.guardianDecision;
  const offer = state.offers.find((o) => o.offerId === state.recommendation?.recommendedOfferId);
  const supplier = state.suppliers.find((s) => s.supplierId === offer?.supplierId);
  const lemhaf = state.agentRuns.find((r) => r.agent === "LEMHAF");
  const reviewEvent = [...state.auditEvents].reverse().find((e) => e.eventType === "HUMAN_REVIEW_REQUIRED");
  const locked = state.payments.find((p) => p.status === "SCHEDULED");
  const org = ORGANIZATIONS[organizationOf(state.mission)];
  const live = config?.hedera.mode === "LIVE_TESTNET";

  const ready = reason.trim().length >= 5 && !!actor && pin.trim().length >= 4 && config?.operatorAuth !== "DISABLED";
  const decide = async (d: "APPROVED" | "REJECTED") => {
    setBusy(true);
    try {
      await onDecide(d, reason.trim(), actor, pin.trim());
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={<span className="text-amber">⚠ Human approval required</span>} right={<Chip label="Demo operator mode" tone="gold" />} className="border-amber/50 shadow-[0_0_0_1px_rgba(245,158,11,0.25),0_10px_40px_-15px_rgba(245,158,11,0.5)]">
      <div className="grid gap-3 p-4 text-[13px]">
        <p className="text-ink-300">Payment is <b className="text-amber">stopped</b>. 3ASES requires an authorized operator to decide. Only an approval bound to these exact facts lets KANAWITA pay.</p>
        {locked && (
          <div className="grid gap-1.5 rounded-xl border border-teal/40 bg-teal/[0.07] p-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-teal">🔒 Locked on {live ? "Hedera" : "the ledger (simulated)"}</b>
              <Chip label="1 of 2 signatures" tone="amber" />
              <ExtLink href={locked.scheduleHashscanUrl}>schedule {locked.scheduleId}</ExtLink>
            </div>
            <span className="text-ink-300">
              {locked.settlementCurrency === "HBAR" ? `${locked.settlementAmount} ℏ` : `${locked.settlementAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${locked.settlementCurrency}`} wait in the 2-of-2 vault{locked.vaultAccountId && live ? ` ${locked.vaultAccountId}` : ""}. The agents already signed; the funds move only when your approval adds the approver&apos;s signature, and Hedera executes the transfer itself. Reject, and the schedule is deleted.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-ink-950/50 p-3 text-[12px]">
          <div><div className="text-ink-400">Mission · {org.shortName}</div>{state.mission.beneficiaries.toLocaleString("en-US")} {org.peopleLabel} · {state.mission.location}</div>
          <div><div className="text-ink-400">Amount</div><b>{usd(offer?.totalPrice)}</b> of {usd(state.mission.maximumBudget)}</div>
          <div><div className="text-ink-400">Supplier</div>{supplier?.name} {supplier && <Chip label={supplier.verified ? "VERIFIED" : "UNVERIFIED"} />}</div>
          <div><div className="text-ink-400">Risk</div>{g && <Chip label={`RISK ${g.riskLevel}`} />}</div>
          <div><div className="text-ink-400">AI recommendation</div>{lemhaf?.mode === "REAL_AI" ? `Claude (${lemhaf.model})` : "Rule-based fallback"}</div>
          <div><div className="text-ink-400">Nasnes</div>{state.verification && <Chip label={state.verification.status} />}</div>
          <div className="col-span-2"><div className="text-ink-400">Hedera proof of this review request</div>{reviewEvent ? <Chip label={reviewEvent.anchor.status} /> : "—"}</div>
        </div>
        {g && (
          <ul className="grid gap-1 text-[12px]">
            {g.checks.filter((c) => c.outcome !== "PASS").map((c) => (
              <li key={c.id} className="text-amber">! {c.label}: <span className="text-ink-300">{c.detail}</span></li>
            ))}
            {g.riskFactors.map((f) => (
              <li key={f} className="text-ink-400">• {f}</li>
            ))}
          </ul>
        )}
        <label className="grid gap-1 text-[12px] text-ink-400">
          Operator
          <select value={actor} onChange={(e) => setActor(e.target.value)} className="rounded-lg border border-ink-700 bg-ink-950 p-2 text-ink-100">
            {operators.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-ink-400">
          Reason (required, recorded on the audit trail)
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Need confirmed by field team; supplier capacity checked" className="resize-none rounded-lg border border-ink-700 bg-ink-950 p-2 text-ink-100 placeholder:text-ink-600 focus:border-amber focus:outline-none" />
        </label>
        <label className="grid gap-1 text-[12px] text-ink-400">
          Operator PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="rounded-lg border border-ink-700 bg-ink-950 p-2 tracking-[0.4em] text-ink-100 placeholder:text-ink-600 focus:border-amber focus:outline-none"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="success" disabled={busy || !ready} onClick={() => decide("APPROVED")}>✓ Approve</Button>
          <Button variant="danger" disabled={busy || !ready} onClick={() => decide("REJECTED")}>✕ Reject</Button>
        </div>
        <p className="text-[10.5px] text-ink-400">Demo operator mode: authorized operator + PIN checked on the server (5 wrong PINs lock the mission for a minute). Not a production identity system.</p>
      </div>
    </Panel>
  );
}
