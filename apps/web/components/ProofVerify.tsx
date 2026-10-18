"use client";
import type { EventVerification, MissionState, PublicConfig } from "@eljoker/shared";
import { useState } from "react";
import type { TamperMode, TamperResult } from "@/lib/api";
import { cx, shortHash } from "@/lib/format";
import { Button, Chip, ExtLink } from "./ui";

function Mark({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-ink-400">—</span>;
  return <span className={ok ? "text-mint" : "text-[#ff5c6a]"}>{ok ? "✓" : "✕"}</span>;
}

function EventRow({ v, highlight }: { v: EventVerification; highlight: boolean }) {
  const bad = v.status === "TAMPERED";
  return (
    <div className={cx("grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_1fr_190px]", bad ? "border-tn-red/60 bg-tn-red/[0.08]" : "border-ink-700 bg-ink-850", highlight && "ring-2 ring-tn-red")}>
      <div className="min-w-0">
        <div className="mb-1 text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">Local record · #{v.sequence} {v.eventType}</div>
        <div className="grid gap-0.5 text-[11px] text-ink-400">
          <span>stored evidence hash <span className="hash text-ink-300">{shortHash(v.local.storedEvidenceHash, 16)}</span></span>
          <span>recomputed now <span className={cx("hash", v.checks.evidenceHashIntact ? "text-ink-300" : "text-[#ff5c6a]")}>{shortHash(v.local.recomputedEvidenceHash, 16)}</span></span>
          <span>event hash <span className={cx("hash", v.checks.eventHashIntact ? "text-ink-300" : "text-[#ff5c6a]")}>{shortHash(v.local.recomputedEventHash, 16)}</span></span>
          <span>chain link <Mark ok={v.checks.chainLinkValid} /></span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">{v.ledger?.source === "SIMULATED_LEDGER" ? "Simulated ledger proof" : "Hedera proof (Mirror Node)"}</div>
        {v.ledger ? (
          <div className="grid gap-0.5 text-[11px] text-ink-400">
            <span>evidence hash <span className="hash text-ink-300">{shortHash(v.ledger.evidenceHash, 16)}</span></span>
            <span>event hash <span className="hash text-ink-300">{shortHash(v.ledger.eventHash, 16)}</span></span>
            <span>{v.ledger.topicId} · seq {v.ledger.sequenceNumber}{v.ledger.consensusTimestamp ? ` · ${v.ledger.consensusTimestamp}` : ""}</span>
            {v.ledger.hashscanUrl && <ExtLink href={v.ledger.hashscanUrl}>HashScan</ExtLink>}
          </div>
        ) : (
          <span className="text-[11px] text-amber">{v.problems[0] ?? "No proof"}</span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1">
        <div className="text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">Result</div>
        <Chip label={v.status === "SIMULATED_VALID" ? "VALID · SIMULATED" : v.status === "TAMPERED" ? "TAMPERING DETECTED" : v.status} />
        <span className="text-[11px] text-ink-400">matches ledger <Mark ok={v.checks.matchesLedger} /></span>
        {bad && v.problems.map((p) => <span key={p} className="text-[11px] text-[#ff5c6a]">{p}</span>)}
      </div>
    </div>
  );
}

export function ProofVerify({ state, config, onVerify, onTamper }: { state: MissionState; config: PublicConfig | null; onVerify: () => Promise<void>; onTamper: (mode: TamperMode) => Promise<TamperResult | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [tamper, setTamper] = useState<TamperResult | null>(null);
  const report = state.lastVerification;
  const live = config?.hedera.mode === "LIVE_TESTNET";
  const pendingAnchors = state.auditEvents.some((e) => e.anchor.status === "PENDING");

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const banner = !report
    ? null
    : report.overall === "VALID"
      ? { cls: "border-mint/50 bg-mint/10 text-mint", title: live ? "PROOF VERIFIED" : "PROOF VERIFIED · SIMULATED LEDGER", text: report.summary }
      : report.overall === "TAMPERING_DETECTED"
        ? { cls: "border-tn-red bg-tn-red/15 text-[#ff5c6a]", title: "TAMPERING DETECTED", text: report.summary }
        : { cls: "border-amber/50 bg-amber/10 text-amber", title: report.overall, text: report.summary };

  return (
    <div className="grid gap-4 p-4">
      <div className="rounded-2xl border border-sidi/30 bg-sidi/[0.06] p-4">
        <h3 className="font-display text-base font-bold text-sidi">Why Hedera? Why not just a database?</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-300">
          Every decision is canonicalized and hashed (SHA-256). Each event links to the previous one, and its hashes are published to a Hedera Consensus Service topic.{" "}
          <b className="text-ink-100">A normal app can edit its own history — even recompute its own hashes. It cannot rewrite the consensus record.</b> Verification recomputes everything from the local database and compares it with what the Mirror Node returns.
        </p>
        {!live && <p className="mt-2 text-[12px] text-amber">Hedera credentials are not configured: proofs are written to a clearly labeled SIMULATED ledger. Configure .env to anchor on testnet.</p>}
        <p className="mt-2 text-[13px] text-ink-300">
          Don&apos;t trust this server either:{" "}
          <a href={`/verify?mission=${state.mission.missionId}`} target="_blank" rel="noreferrer" className="font-semibold text-teal underline decoration-teal/40 underline-offset-2">
            open the public verifier ↗
          </a>{" "}
          — your own browser recomputes every hash and reads the Mirror Node directly.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy !== null || state.auditEvents.length === 0} onClick={() => run("verify", onVerify)}>
          {busy === "verify" ? "Verifying… (reading Mirror Node)" : "🔎 Verify against Hedera"}
        </Button>
        <span className="mx-1 h-6 w-px bg-ink-700" />
        <Button
          variant="danger"
          disabled={busy !== null || !config?.demoMode || state.auditEvents.length === 0 || pendingAnchors}
          title={!config?.demoMode ? "Disabled outside demo mode" : pendingAnchors ? "Wait for all proofs to be anchored" : undefined}
          onClick={() => run("tamper1", async () => setTamper(await onTamper("EDIT_EVIDENCE")))}
        >
          ⚠ Simulate local tampering
        </Button>
        <Button
          variant="ghost"
          disabled={busy !== null || !config?.demoMode || state.auditEvents.length === 0 || pendingAnchors}
          title="Edits evidence AND recomputes the local hash chain — only Hedera can catch this"
          onClick={() => run("tamper2", async () => setTamper(await onTamper("REWRITE_HASHES")))}
        >
          🕶 Insider rewrites hashes too
        </Button>
        <Button
          variant="ghost"
          disabled={busy !== null || !config?.demoMode || state.auditEvents.length === 0 || pendingAnchors}
          title="Erases the latest event from the local database — the remaining chain stays consistent; only the ledger listing catches it"
          onClick={() => run("tamper3", async () => setTamper(await onTamper("DELETE_LAST_EVENT")))}
        >
          🗑 Delete last event
        </Button>
        <Chip label="Demo only" tone="gold" />
      </div>

      {tamper && (
        <div className="rounded-xl border border-tn-red/40 bg-ink-850 p-3 text-[12px]">
          <span className="font-bold text-[#ff5c6a]">Local database edited:</span> {tamper.eventType} · <span className="font-mono">{tamper.field}</span>: <span className="line-through">{JSON.stringify(tamper.before)}</span> → <b>{JSON.stringify(tamper.after)}</b>. Now press <b>Verify against Hedera</b>.
        </div>
      )}

      {banner && (
        <div className={cx("rounded-2xl border-2 p-4", banner.cls)}>
          <div className="font-display text-2xl font-black tracking-tight">{banner.title}</div>
          <div className="mt-1 text-[13px] text-ink-100">{banner.text}</div>
          <div className="mt-1 text-[11px] text-ink-400">Verified at {new Date(report!.verifiedAt).toLocaleTimeString()} · source: {report!.ledgerMode === "LIVE_TESTNET" ? "Hedera testnet Mirror Node" : "simulated ledger"}</div>
        </div>
      )}

      {report && (
        <div className="grid gap-2">
          <div className="hidden grid-cols-[1fr_1fr_190px] gap-3 px-3 text-[11px] font-bold tracking-widest text-ink-400 uppercase md:grid">
            <span>Local record</span>
            <span>Hedera proof</span>
            <span>Verification result</span>
          </div>
          {report.events.map((v) => (
            <EventRow key={v.eventId} v={v} highlight={tamper?.eventId === v.eventId} />
          ))}
          {report.missingLocalEvents.map((m) => (
            <div key={m.eventId} className="grid gap-3 rounded-xl border-2 border-dashed border-tn-red/70 bg-tn-red/[0.08] p-3 md:grid-cols-[1fr_1fr_190px]">
              <div>
                <div className="mb-1 text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">Local record · #{m.sequence ?? "?"} {m.eventType}</div>
                <div className="text-[13px] font-semibold text-[#ff8a94]">✕ Missing — deleted from the local database</div>
              </div>
              <div className="min-w-0">
                <div className="mb-1 text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">{report.ledgerMode === "LIVE_TESTNET" ? "Hedera proof (Mirror Node)" : "Simulated ledger proof"}</div>
                <div className="grid gap-0.5 text-[11px] text-ink-400">
                  <span>proof still on the ledger · seq #{m.ledgerSequenceNumber}</span>
                  {m.consensusTimestamp && <span>consensus {m.consensusTimestamp}</span>}
                  {m.hashscanUrl && <ExtLink href={m.hashscanUrl}>HashScan</ExtLink>}
                </div>
              </div>
              <div className="flex flex-col items-start gap-1">
                <div className="text-[10.5px] font-bold tracking-widest text-ink-400 uppercase">Result</div>
                <Chip label="TAMPERING DETECTED" />
                <span className="text-[11px] text-[#ff5c6a]">History was deleted locally</span>
              </div>
            </div>
          ))}
          {report.ledgerEventCount != null && (
            <p className="px-1 text-[12px] text-ink-400">
              Completeness: the ledger holds {report.ledgerEventCount} proof(s) for this mission; {report.events.length} local event(s) were checked{report.missingLocalEvents.length ? `, ${report.missingLocalEvents.length} missing locally` : ", none missing"}.
            </p>
          )}
        </div>
      )}
      {!report && <p className="text-sm text-ink-400">Run a verification to compare the local record with the ledger proof.</p>}
    </div>
  );
}
