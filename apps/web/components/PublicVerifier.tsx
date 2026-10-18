"use client";
import { type BundleVerification, type LedgerCopy, type MissionSummary, ORGANIZATIONS, type ProofBundle, verifyBundle } from "@eljoker/shared";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx, shortHash, usd } from "@/lib/format";
import { missionChip } from "@/lib/status";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import { Button, Chip, ExtLink, Panel } from "./ui";

/* ------------------------------------------------------------------ */
/* Everything below runs in the visitor's browser                      */
/* ------------------------------------------------------------------ */

/** SHA-256 computed by the browser itself (Web Crypto), not by our server. */
async function browserSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const decodeBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/** "0.0.1@1700000000.123?scheduled" -> path "0.0.1-1700000000-123" + query (Mirror Node format). */
function mirrorTx(txId: string): { path: string; query: string } {
  const scheduled = txId.endsWith("?scheduled");
  const [account, ts] = txId.replace(/\?scheduled$/, "").split("@");
  return { path: account && ts ? `${account}-${ts.replace(".", "-")}` : txId, query: scheduled ? "?scheduled=true" : "" };
}

async function mirrorJson<T>(base: string, path: string): Promise<T | null> {
  const res = await fetch(`${base}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror Node HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Read the mission's proofs straight from the public Hedera Mirror Node (no EL JOKER server involved). */
async function readTopicFromMirror(base: string, topicId: string, sinceIso: string): Promise<LedgerCopy[]> {
  const since = (Date.parse(sinceIso) / 1000).toFixed(9);
  let next: string | null = `/api/v1/topics/${topicId}/messages?limit=100&order=asc&timestamp=gte:${since}`;
  const out: LedgerCopy[] = [];
  for (let page = 0; next && page < 30; page++) {
    const body: { messages?: { message: string; sequence_number: number; consensus_timestamp: string }[]; links?: { next?: string | null } } | null = await mirrorJson(base, next);
    if (!body) break;
    for (const m of body.messages ?? []) out.push({ sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp, message: decodeBase64(m.message) });
    next = body.links?.next ?? null;
  }
  return out;
}

interface PaymentCheck {
  paymentId: string;
  label: string;
  ok: boolean | null;
  lines: string[];
  links: { href: string; text: string }[];
}

const HASHSCAN = "https://hashscan.io/testnet";

async function checkPayments(bundle: ProofBundle, live: boolean): Promise<PaymentCheck[]> {
  const out: PaymentCheck[] = [];
  for (const p of bundle.payments) {
    const amount = p.settlementCurrency === "HBAR" ? `${p.settlementAmount} ℏ` : `${p.settlementAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${p.settlementCurrency}`;
    const label = `${p.source === "VAULT" ? "Vault payment (2-of-2)" : "Payment"} · ${amount} for a ${usd(p.amountUsd)} offer · ${p.status}`;
    if (!live) {
      out.push({ paymentId: p.paymentId, label, ok: null, lines: ["Simulated ledger: there is no public network to read this payment from."], links: [] });
      continue;
    }
    const lines: string[] = [];
    const links: { href: string; text: string }[] = [];
    let ok: boolean | null = null;
    try {
      if (p.scheduleId) {
        const s = await mirrorJson<{ executed_timestamp?: string | null; deleted?: boolean; signatures?: unknown[] }>(bundle.mirrorNodeUrl, `/api/v1/schedules/${p.scheduleId}`);
        const sigs = Array.isArray(s?.signatures) ? s!.signatures!.length : 0;
        lines.push(s ? `Schedule ${p.scheduleId}: ${s.executed_timestamp ? `executed by Hedera at ${s.executed_timestamp}` : s.deleted ? "deleted (never executed)" : "pending, not executed"} · ${sigs} signature(s) on the ledger` : `Schedule ${p.scheduleId} not visible on the Mirror Node yet`);
        links.push({ href: `${HASHSCAN}/schedule/${p.scheduleId}`, text: "schedule on HashScan" });
        if (p.status === "CONFIRMED") ok = !!s?.executed_timestamp && sigs >= 2;
        else if (p.status === "CANCELLED") ok = !s?.executed_timestamp;
        else if (p.status === "SCHEDULED") ok = !s?.executed_timestamp;
      }
      if (p.hederaTransactionId && p.status === "CONFIRMED") {
        const { path, query } = mirrorTx(p.hederaTransactionId);
        const tx = await mirrorJson<{ transactions?: { result?: string; consensus_timestamp?: string; scheduled?: boolean }[] }>(bundle.mirrorNodeUrl, `/api/v1/transactions/${path}${query}`);
        const t = tx?.transactions?.find((x) => (query ? x.scheduled : true)) ?? tx?.transactions?.[0];
        lines.push(t ? `Transfer ${p.hederaTransactionId}: ${t.result} at consensus ${t.consensus_timestamp}` : `Transfer ${p.hederaTransactionId} not visible on the Mirror Node yet`);
        if (t?.consensus_timestamp) links.push({ href: `${HASHSCAN}/transaction/${t.consensus_timestamp}`, text: "transfer on HashScan" });
        ok = (ok ?? true) && t?.result === "SUCCESS";
      }
    } catch (e) {
      lines.push(`Mirror Node not reachable: ${e instanceof Error ? e.message : String(e)}`);
      ok = null;
    }
    out.push({ paymentId: p.paymentId, label, ok, lines, links });
  }
  return out;
}

/* ------------------------------------------------------------------ */

type Step = "idle" | "running" | "done" | "error";
interface Progress {
  claims: Step;
  ledger: Step;
  recompute: Step;
  payments: Step;
}

export function PublicVerifier() {
  const params = useSearchParams();
  const [missionId, setMissionId] = useState(params.get("mission") ?? "");
  const [recent, setRecent] = useState<MissionSummary[]>([]);
  const [progress, setProgress] = useState<Progress>({ claims: "idle", ledger: "idle", recompute: "idle", payments: "idle" });
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [copies, setCopies] = useState<LedgerCopy[]>([]);
  const [result, setResult] = useState<BundleVerification | null>(null);
  const [payments, setPayments] = useState<PaymentCheck[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.missions().then(setRecent).catch(() => undefined);
  }, []);

  const run = useCallback(async (id: string) => {
    const target = id.trim();
    if (!target) return;
    setError(null);
    setBundle(null);
    setResult(null);
    setPayments([]);
    setCopies([]);
    setProgress({ claims: "running", ledger: "idle", recompute: "idle", payments: "idle" });
    let b: ProofBundle;
    try {
      b = await api.bundle(target);
      setBundle(b);
      setProgress((p) => ({ ...p, claims: "done", ledger: "running" }));
    } catch (e) {
      setProgress((p) => ({ ...p, claims: "error" }));
      setError(e instanceof ApiError && e.status === 404 ? `No mission "${target}" on this server.` : "Could not download the server's claims.");
      return;
    }
    const live = b.ledgerMode === "LIVE_TESTNET" && !!b.topicId;
    let ledger: LedgerCopy[];
    try {
      // Five minutes of margin before the mission was created, like the server's own verifier.
      ledger = live ? await readTopicFromMirror(b.mirrorNodeUrl, b.topicId!, new Date(Date.parse(b.missionCreatedAt) - 5 * 60_000).toISOString()) : (b.simulatedLedger ?? []);
      setCopies(ledger);
      setProgress((p) => ({ ...p, ledger: "done", recompute: "running" }));
    } catch (e) {
      setProgress((p) => ({ ...p, ledger: "error" }));
      setError(`Could not read the Hedera Mirror Node from your browser: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const v = await verifyBundle(b, ledger, browserSha256);
    setResult(v);
    setProgress((p) => ({ ...p, recompute: "done", payments: "running" }));
    setPayments(await checkPayments(b, live));
    setProgress((p) => ({ ...p, payments: "done" }));
  }, []);

  // Deep link: /verify?mission=msn_… runs immediately.
  useEffect(() => {
    const id = params.get("mission");
    if (id) void run(id);
  }, [params, run]);

  const live = bundle?.ledgerMode === "LIVE_TESTNET";
  const mine = bundle ? copies.filter((c) => c.message.includes(bundle.missionId)).length : 0;
  const banner = !result
    ? null
    : result.overall === "VALID"
      ? { cls: "border-mint/50 bg-mint/10 text-mint", title: live ? "VERIFIED ON HEDERA" : "VERIFIED · SIMULATED LEDGER", text: result.summary }
      : result.overall === "TAMPERING_DETECTED"
        ? { cls: "border-tn-red bg-tn-red/15 text-[#ff5c6a]", title: "TAMPERING DETECTED", text: result.summary }
        : { cls: "border-amber/50 bg-amber/10 text-amber", title: "NOT COMPLETE YET", text: result.summary };

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden">
      <Backdrop />
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-4 px-5 py-3">
          <a href="/" className="flex items-center gap-3" aria-label="EL JOKER home">
            <Logo size={36} />
            <span className="font-display text-lg font-bold">
              EL JOKER <span className="text-indigo">2.0</span>
            </span>
          </a>
          <Chip label="Public verifier" tone="teal" />
          <span className="ml-auto text-xs text-ink-400">Runs entirely in your browser</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)] gap-5 px-5 py-8">
        <section className="grid gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">Don&apos;t trust us. Check it.</h1>
          <p className="max-w-3xl text-[15px] leading-relaxed text-ink-300">
            Pick a mission. Your browser downloads what our server <i>claims</i> happened, reads the proofs <b className="text-white">directly from the public Hedera Mirror Node</b>, recomputes every SHA-256 fingerprint itself and compares the two. If anyone edited, rewrote or deleted part of the history — including us — it shows here.
          </p>
        </section>

        <Panel title="Mission">
          <form
            className="flex flex-wrap items-center gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(missionId);
            }}
          >
            <label htmlFor="mission-id" className="sr-only">Mission id</label>
            <input
              id="mission-id"
              value={missionId}
              onChange={(e) => setMissionId(e.target.value)}
              placeholder="msn_…"
              className="min-w-0 flex-1 rounded-2xl border border-ink-700 bg-ink-950/70 px-4 py-3 font-mono text-sm text-ink-100 placeholder:text-ink-600 focus:border-teal focus:outline-none"
            />
            <Button variant="gold" disabled={!missionId.trim() || progress.recompute === "running" || progress.claims === "running" || progress.ledger === "running"} onClick={() => void run(missionId)}>
              Verify this mission
            </Button>
          </form>
          {recent.length > 0 && (
            <div className="scroll-thin flex gap-2 overflow-x-auto px-5 pb-5">
              {recent.slice(0, 12).map((m) => (
                <button
                  key={m.missionId}
                  type="button"
                  onClick={() => {
                    setMissionId(m.missionId);
                    void run(m.missionId);
                  }}
                  className={cx("shrink-0 rounded-2xl border px-3 py-2 text-left text-[12px] transition hover:border-white/25", m.missionId === bundle?.missionId ? "border-teal/60 bg-teal/10" : "border-white/10 bg-white/[0.03]")}
                >
                  <div className="font-semibold text-white">
                    {m.scenarioId ? `${m.scenarioId.slice(0, 1)} · ` : ""}
                    {m.location} · {usd(m.maximumBudget)}
                  </div>
                  <div className="text-ink-400">
                    {ORGANIZATIONS[m.organizationId ?? "NGO_RELIEF"].shortName} · {missionChip(m.status)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <div className="grid gap-3 md:grid-cols-4">
          {(
            [
              ["claims", "1. Download the claims", "What our server says happened (untrusted).", bundle ? `${bundle.events.length} events, ${bundle.payments.length} payment(s)` : null],
              ["ledger", "2. Read Hedera yourself", live ? `From ${bundle?.mirrorNodeUrl.replace("https://", "")}` : bundle ? "Simulated ledger (no public network)" : "Public Mirror Node, straight from your browser.", bundle ? `${mine} proof(s) for this mission` : null],
              ["recompute", "3. Recompute in your browser", "SHA-256 of every piece of evidence and every event header.", result ? `${result.events.filter((e) => e.status === "VALID").length}/${result.events.length} match their proof` : null],
              ["payments", "4. Check the money", "Transfers and vault schedules on the ledger.", payments.length ? `${payments.length} payment(s) checked` : bundle && bundle.payments.length === 0 ? "No payment" : null],
            ] as [keyof Progress, string, string, string | null][]
          ).map(([k, title, text, outcome]) => (
            <div key={k} className={cx("glass rounded-3xl p-4", progress[k] === "running" && "ring-1 ring-indigo/60", progress[k] === "error" && "ring-1 ring-tn-red/60")}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-bold text-white">{title}</h2>
                <span className="text-[12px]">{progress[k] === "done" ? "✓" : progress[k] === "running" ? "…" : progress[k] === "error" ? "✕" : ""}</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-ink-400">{text}</p>
              {outcome && <p className="mt-2 text-[12px] font-semibold text-ink-100">{outcome}</p>}
            </div>
          ))}
        </div>

        {error && (
          <div className="rounded-2xl border border-tn-red/50 bg-tn-red/10 px-5 py-3 text-sm text-[#ff9aa3]" role="alert">
            {error}
          </div>
        )}

        {bundle && !live && (
          <div className="rounded-2xl border border-amber/40 bg-amber/10 px-5 py-3 text-[13px] text-amber">
            This server runs without Hedera credentials, so its proofs live on a clearly labeled SIMULATED ledger that it serves itself. The recomputation below still works, but it is not independent. On testnet, step 2 reads Hedera directly.
          </div>
        )}

        {banner && (
          <div className={cx("rounded-3xl border-2 p-5", banner.cls)} role="status">
            <div className="font-display text-3xl font-black tracking-tight">{banner.title}</div>
            <div className="mt-1 text-[14px] text-ink-100">{banner.text}</div>
            {result && (
              <div className="mt-2 text-[12px] text-ink-400">
                Ledger chain checked from Hedera alone: {result.ledgerChain.count} proof(s), numbered without gaps: {result.ledgerChain.contiguous ? "yes" : "NO"} · each linked to the previous one: {result.ledgerChain.linked ? "yes" : "NO"}
              </div>
            )}
          </div>
        )}

        {bundle && result && (
          <Panel title={`${ORGANIZATIONS[bundle.organizationId].name} · ${bundle.description}`} right={live && bundle.topicId ? <ExtLink href={`${HASHSCAN}/topic/${bundle.topicId}`}>topic {bundle.topicId}</ExtLink> : undefined}>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead className="text-[10.5px] tracking-widest text-ink-400 uppercase">
                  <tr className="border-b border-white/[0.07]">
                    <th className="px-5 py-3">#</th>
                    <th className="px-3 py-3">Event</th>
                    <th className="px-3 py-3">Evidence hash (your browser)</th>
                    <th className="px-3 py-3">On Hedera</th>
                    <th className="px-3 py-3">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.events.map((e) => {
                    const ev = bundle.events.find((x) => x.eventId === e.eventId)!;
                    return (
                      <tr key={e.eventId} className={cx("border-b border-white/[0.05] align-top", e.status === "TAMPERED" && "bg-tn-red/[0.08]")}>
                        <td className="px-5 py-3 font-mono text-ink-400">{e.sequence}</td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-white">{e.eventType}</div>
                          <div className="text-ink-400">{ev.summary}</div>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11.5px]">
                          <span className={e.checks.evidenceHash ? "text-ink-300" : "text-[#ff5c6a]"}>{shortHash(ev.evidenceHash, 14)}</span>
                          <div className="text-ink-400">chain link {e.checks.chainLink ? "✓" : "✕"} · header {e.checks.eventHash ? "✓" : "✕"}</div>
                        </td>
                        <td className="px-3 py-3 text-[11.5px] text-ink-400">
                          {e.ledgerSequenceNumber != null ? (
                            <>
                              <div>seq #{e.ledgerSequenceNumber}</div>
                              <div>{e.consensusTimestamp}</div>
                              {live && e.consensusTimestamp && <ExtLink href={`${HASHSCAN}/transaction/${e.consensusTimestamp}`}>HashScan</ExtLink>}
                            </>
                          ) : (
                            <span className="text-amber">not found yet</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Chip label={e.status === "VALID" ? "MATCHES" : e.status === "TAMPERED" ? "TAMPERED" : "PENDING"} />
                          {e.problems.length > 0 && e.status !== "VALID" && <div className="mt-1 text-[11px] text-[#ff8a94]">{e.problems[0]}</div>}
                        </td>
                      </tr>
                    );
                  })}
                  {result.missingFromBundle.map((m) => (
                    <tr key={m.eventId} className="border-b border-white/[0.05] bg-tn-red/[0.08] align-top">
                      <td className="px-5 py-3 font-mono text-ink-400">{m.sequence ?? "?"}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-[#ff8a94]">{m.eventType}</div>
                        <div className="text-ink-400">Missing from the server&apos;s history</div>
                      </td>
                      <td className="px-3 py-3 text-[11.5px] text-ink-400">—</td>
                      <td className="px-3 py-3 text-[11.5px] text-ink-400">
                        <div>seq #{m.ledgerSequenceNumber}</div>
                        <div>{m.consensusTimestamp}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Chip label="DELETED" tone="red" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {payments.length > 0 && (
          <Panel title="Money on the ledger">
            <div className="grid gap-3 p-5">
              {payments.map((p) => (
                <div key={p.paymentId} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-white">{p.label}</b>
                    {p.ok !== null && <Chip label={p.ok ? "CONFIRMED ON HEDERA" : "DOES NOT MATCH"} />}
                  </div>
                  <ul className="mt-2 grid gap-1 text-ink-300">
                    {p.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {p.links.map((l) => (
                      <ExtLink key={l.href} href={l.href}>
                        {l.text}
                      </ExtLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <p className="text-[12px] leading-relaxed text-ink-400">
          How it works: each EL JOKER decision is turned into canonical JSON and fingerprinted with SHA-256. Each event commits to the previous one (a hash chain), and only the fingerprints are published on a Hedera Consensus Service topic — no names, prices or documents. This page does the same computation with your browser&apos;s Web Crypto and compares it with consensus. The code is open:{" "}
          <ExtLink href="https://github.com/rihamghoudi-bit/el-joker-2">github.com/rihamghoudi-bit/el-joker-2</ExtLink>
        </p>
      </main>
    </div>
  );
}
