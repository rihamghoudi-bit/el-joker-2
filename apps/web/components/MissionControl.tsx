"use client";
import type { MissionState, MissionSummary, PublicConfig, ScenarioInfo } from "@eljoker/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AgentLineup } from "./AgentLineup";
import { ApprovalCard } from "./ApprovalCard";
import { AuditTimeline } from "./AuditTimeline";
import { Backdrop } from "./Backdrop";
import { ChatFeed } from "./ChatFeed";
import { Composer, Hero } from "./Hero";
import { KpiStrip } from "./KpiStrip";
import { ProofFeed } from "./ProofFeed";
import { ProofVerify } from "./ProofVerify";
import { missionChip, StatusBoard } from "./StatusBoard";
import { TopBar, type View } from "./TopBar";
import { Button, Chip, Panel } from "./ui";

const ACTIVE = ["CREATED", "RESEARCHING", "VERIFYING", "EVALUATING", "APPROVED", "PAYING"];

export function MissionControl() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<MissionState | null>(null);
  const [view, setView] = useState<View>("conversation");
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refreshList = useCallback(() => api.missions().then(setMissions).catch(() => undefined), []);

  // Initial load; keeps retrying so the page recovers if the API starts after the UI.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      Promise.all([api.config(), api.scenarios(), api.missions()])
        .then(([c, s, m]) => {
          if (stop) return;
          setConfig(c);
          setScenarios(s);
          setMissions(m);
          setApiDown(false);
        })
        .catch(() => {
          if (stop) return;
          setApiDown(true);
          timer = setTimeout(load, 2500);
        });
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  // Poll the active mission: fast while agents work, slower when idle.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.mission(activeId);
        if (stop || activeRef.current !== activeId) return;
        setState(s);
        setApiDown(false);
        const fast = s.busy || ACTIVE.includes(s.mission.status) || s.auditEvents.some((e) => e.anchor.status === "PENDING");
        timer = setTimeout(tick, fast ? 800 : 3000);
      } catch {
        if (!stop) {
          setApiDown(true);
          timer = setTimeout(tick, 3000);
        }
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [activeId]);

  const statusKey = state ? `${state.mission.missionId}:${state.mission.status}` : "";
  useEffect(() => {
    if (statusKey) void refreshList();
  }, [statusKey, refreshList]);

  const select = (id: string) => {
    setState(null);
    setActiveId(id);
    setView("conversation");
    setNotice(null);
    setError(null);
  };
  const goHome = () => {
    setActiveId(null);
    setState(null);
    setNotice(null);
    setError(null);
  };

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Request failed — is the API running on :4000?");
    }
  };

  const runScenario = (id: string) =>
    guard(async () => {
      setLaunching(id);
      try {
        const { missionId } = await api.runScenario(id);
        await refreshList();
        select(missionId);
        const sc = scenarios.find((s) => s.id === id);
        if (sc?.followUp) setNotice(`Scenario ${sc.letter}: ${sc.followUp}`);
      } finally {
        setLaunching(null);
      }
    });

  const submitText = (text: string) =>
    guard(async () => {
      setLaunching("text");
      try {
        const out = await api.createFromText(text);
        await refreshList();
        select(out.missionId);
      } finally {
        setLaunching(null);
      }
    });

  const refreshNow = async () => {
    if (activeId) setState(await api.mission(activeId));
  };

  const mission = state?.mission;
  const scenarioLetter = mission?.scenarioId?.slice(0, 1);

  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <Backdrop />
      <TopBar config={config} view={view} onView={setView} hasMission={!!state} missions={missions} activeId={activeId} onSelect={select} onNew={goHome} />

      {apiDown && (
        <div className="mx-auto mt-4 w-full max-w-[1500px] px-6 lg:px-10">
          <div className="rounded-2xl border border-tn-red/50 bg-tn-red/10 px-5 py-3 text-sm text-[#ff9aa3]">
            API not reachable on :4000 — start it with <code className="font-mono">npm run dev</code> from the repo root. Retrying…
          </div>
        </div>
      )}

      {!activeId ? (
        <Hero scenarios={scenarios} launching={launching} onRunScenario={runScenario} onSend={submitText} />
      ) : !state || !mission ? (
        <div className="grid flex-1 place-items-center text-ink-400">Loading mission…</div>
      ) : (
        <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-8 px-6 py-10 lg:px-10">
          {/* Mission header */}
          <section className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {scenarioLetter && <span className="rounded-lg bg-gold px-2.5 py-1 font-display text-xs font-bold text-black">SCENARIO {scenarioLetter}</span>}
                {mission.isDemo && <Chip label="Demo data" tone="gold" />}
                <span className="text-xs text-ink-400">{mission.missionId}</span>
              </div>
              <h1 className="font-display text-3xl leading-tight font-bold tracking-tight md:text-4xl">{mission.location} — {mission.beneficiaries.toLocaleString("en-US")} people</h1>
              <p className="mt-2 text-base text-ink-300">{mission.description}</p>
            </div>
            <div className="flex items-center gap-3">
              <Chip label={missionChip(mission.status)} className="px-4 py-1.5 text-sm" />
              {state.lastVerification && <Chip label={state.lastVerification.overall === "VALID" ? "PROOF VERIFIED" : state.lastVerification.overall.replace("_", " ")} className="px-4 py-1.5 text-sm" />}
            </div>
          </section>

          <KpiStrip state={state} />
          <AgentLineup state={state} />

          {notice && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-3 text-sm text-gold">
              <span>{notice}</span>
              <button type="button" className="text-xs text-ink-400 hover:text-white" onClick={() => setNotice(null)}>dismiss</button>
            </div>
          )}
          {error && <div className="rounded-2xl border border-tn-red/50 bg-tn-red/10 px-5 py-3 text-sm text-[#ff9aa3]">{error}</div>}

          {view === "conversation" && (
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_440px]">
              <Panel
                title="Mission conversation"
                right={state.currentAgent ? <Chip label="LIVE" tone="violet" /> : <Chip label={missionChip(mission.status)} />}
                className="flex h-[78vh] min-h-[560px] flex-col overflow-hidden"
              >
                <div className="relative min-h-0 flex-1">
                  <div className="absolute inset-0">
                    <ChatFeed state={state} />
                  </div>
                </div>
                <div className="border-t border-white/[0.07] px-6 py-4">
                  <Composer compact onSend={submitText} disabled={launching !== null} />
                  <p className="mt-2 text-[11px] text-ink-400">A new request starts a new mission. Lem3alem never invents location, people, budget or items.</p>
                </div>
              </Panel>

              <aside className="flex min-w-0 flex-col gap-6">
                {mission.status === "HUMAN_REVIEW" && (
                  <ApprovalCard
                    state={state}
                    config={config}
                    onDecide={(decision, reason, actorId) =>
                      guard(async () => {
                        await api.approve(mission.missionId, { decision, reason, actorId });
                        await refreshNow();
                      })
                    }
                  />
                )}
                <ProofFeed state={state} config={config} />
                <Panel title="Actions">
                  <div className="grid gap-3 p-5">
                    <Button
                      variant="ghost"
                      disabled={state.auditEvents.length === 0}
                      onClick={() =>
                        guard(async () => {
                          await api.verify(mission.missionId);
                          await refreshNow();
                          setView("proof");
                        })
                      }
                    >
                      🔎 Verify against Hedera
                    </Button>
                    <Button
                      variant="danger"
                      disabled={mission.status !== "PAID" || state.busy}
                      title="Sends exactly the same payment request again"
                      onClick={() =>
                        guard(async () => {
                          const r = await api.replay(mission.missionId);
                          setNotice(r.executed ? "Unexpected: replay executed" : `Replay rejected by Kanawita: ${r.reasons[0] ?? ""}`);
                          await refreshNow();
                        })
                      }
                    >
                      🔁 Replay payment (attack)
                    </Button>
                    <p className="text-xs leading-relaxed text-ink-400">The replay goes through the same Kanawita checks as any payment and is expected to be rejected (idempotency + one live payment per mission, enforced by the database).</p>
                  </div>
                </Panel>
                <details className="group">
                  <summary className="glass cursor-pointer list-none rounded-3xl px-6 py-4 text-sm font-semibold tracking-[0.12em] text-ink-300 uppercase">
                    Full mission details <span className="float-right transition group-open:rotate-180">⌄</span>
                  </summary>
                  <div className="mt-4">
                    <StatusBoard state={state} config={config} />
                  </div>
                </details>
              </aside>
            </div>
          )}

          {view === "audit" && (
            <Panel title="Hash-linked audit trail">
              <AuditTimeline state={state} />
            </Panel>
          )}

          {view === "proof" && (
            <Panel title="Proof & verification">
              <ProofVerify
                state={state}
                config={config}
                onVerify={() =>
                  guard(async () => {
                    await api.verify(mission.missionId);
                    await refreshNow();
                  })
                }
                onTamper={async (mode) => {
                  let out = null;
                  await guard(async () => {
                    out = await api.tamper(mission.missionId, mode);
                    await refreshNow();
                  });
                  return out;
                }}
              />
            </Panel>
          )}
        </main>
      )}

      <footer className="mt-auto px-6 py-8 text-center text-xs text-ink-600">
        EL JOKER 2.0 · Chain619 · Hedera testnet only · suppliers are fictional demo data · no real users, NGOs or partnerships are implied.
      </footer>
    </div>
  );
}
