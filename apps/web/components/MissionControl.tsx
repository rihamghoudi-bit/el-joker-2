"use client";
import type { MissionState, MissionSummary, PublicConfig, ScenarioInfo } from "@eljoker/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx, usd } from "@/lib/format";
import { PipelineStrip } from "./AgentLineup";
import { ApprovalCard } from "./ApprovalCard";
import { AuditTimeline } from "./AuditTimeline";
import { Backdrop } from "./Backdrop";
import { ChatComposer } from "./ChatComposer";
import { ChatFeed } from "./ChatFeed";
import { KpiStrip } from "./KpiStrip";
import { Landing } from "./Landing";
import { ProofFeed } from "./ProofFeed";
import { ProofVerify } from "./ProofVerify";
import { missionChip } from "./StatusBoard";
import { TopBar, type View } from "./TopBar";
import { Avatar, Button, Chip, Panel } from "./ui";

const ACTIVE = ["CREATED", "RESEARCHING", "VERIFYING", "EVALUATING", "APPROVED", "PAYING"];

export function MissionControl() {
  const [page, setPage] = useState<"home" | "chat">("home");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<MissionState | null>(null);
  const [view, setView] = useState<View>("conversation");
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refreshList = useCallback(() => api.missions().then(setMissions).catch(() => undefined), []);

  const pick = useCallback((s: ScenarioInfo) => {
    setSelected(s.id);
    setDraft(s.request);
  }, []);

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
          // Pre-fill the chat with a ready-made request (scenario A).
          if (s[0]) {
            setSelected((cur) => cur ?? s[0]!.id);
            setDraft((cur) => cur || s[0]!.request);
          }
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

  const open = (id: string) => {
    setState(null);
    setActiveId(id);
    setView("conversation");
    setNotice(null);
    setError(null);
    setPage("chat");
  };
  const newChat = () => {
    setActiveId(null);
    setState(null);
    setView("conversation");
    setNotice(null);
    setError(null);
    if (scenarios[0]) pick(scenarios[0]);
  };

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Request failed — is the API running on :4000?");
    }
  };

  /** Send the composer content: an untouched scenario request runs that scenario; anything else is free text. */
  const send = () =>
    guard(async () => {
      const text = draft.trim();
      const sc = scenarios.find((s) => s.id === selected && s.request.trim() === text);
      setLaunching(true);
      try {
        const missionId = sc ? (await api.runScenario(sc.id)).missionId : (await api.createFromText(text)).missionId;
        await refreshList();
        open(missionId);
        setDraft("");
        setSelected(null);
        if (sc?.followUp) setNotice(sc.followUp);
      } finally {
        setLaunching(false);
      }
    });

  const refreshNow = async () => {
    if (activeId) setState(await api.mission(activeId));
  };

  const mission = state?.mission;
  const scenarioLetter = mission?.scenarioId?.slice(0, 1);

  if (page === "home") {
    return (
      <div className="relative isolate flex min-h-screen flex-col">
        <Backdrop mascots />
        <Landing onEnter={() => setPage("chat")} />
      </div>
    );
  }

  return (
    <div className="relative isolate flex h-screen flex-col overflow-hidden">
      <Backdrop />
      <TopBar config={config} view={view} onView={setView} hasMission={!!state} missions={[]} activeId={activeId} onSelect={open} onNew={() => setPage("home")} />

      {apiDown && (
        <div className="mx-6 mt-3 rounded-2xl border border-tn-red/50 bg-tn-red/10 px-5 py-2.5 text-sm text-[#ff9aa3]">
          API not reachable on :4000 — start it with <code className="font-mono">npm run dev</code>. Retrying…
        </div>
      )}

      <div className="mx-auto grid min-h-0 w-full max-w-[1680px] flex-1 gap-5 px-5 py-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_400px]">
        {/* History (like a chat app sidebar) */}
        <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
          <Button onClick={newChat} className="w-full">＋ New request</Button>
          <div className="glass scroll-thin min-h-0 flex-1 overflow-y-auto rounded-3xl p-2">
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.16em] text-ink-400 uppercase">History</div>
            {missions.length === 0 && <p className="px-3 py-2 text-xs text-ink-400">No missions yet.</p>}
            {missions.map((m) => (
              <button
                key={m.missionId}
                type="button"
                onClick={() => open(m.missionId)}
                className={cx("w-full rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]", activeId === m.missionId && "bg-indigo/15 ring-1 ring-indigo/40")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-white">{m.scenarioId ? `${m.scenarioId.slice(0, 1)} · ` : ""}{m.location}</span>
                  <Chip label={missionChip(m.status)} className="px-2 py-0.5 text-[9.5px]" />
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-ink-400">{usd(m.maximumBudget)} · {m.description}</div>
              </button>
            ))}
          </div>
        </aside>

        {view === "conversation" || !state ? (
          <>
            {/* Conversation */}
            <section className="glass flex min-h-0 flex-col overflow-hidden rounded-3xl">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
                <div className="min-w-0">
                  {mission ? (
                    <div className="flex items-center gap-2">
                      {scenarioLetter && <span className="rounded-md bg-gold px-2 py-0.5 font-display text-[11px] font-bold text-black">{scenarioLetter}</span>}
                      <span className="truncate font-display text-base font-semibold">{mission.location} · {usd(mission.maximumBudget)} · {mission.beneficiaries.toLocaleString("en-US")} people</span>
                      <Chip label={missionChip(mission.status)} />
                    </div>
                  ) : (
                    <span className="font-display text-base font-semibold">New request</span>
                  )}
                </div>
                <PipelineStrip state={state} />
              </header>

              <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0">
                  {state ? (
                    <ChatFeed
                      state={state}
                      footer={
                        state.mission.status === "HUMAN_REVIEW" ? (
                          <div className="ml-16">
                            <ApprovalCard
                              state={state}
                              config={config}
                              onDecide={(decision, reason, actorId) =>
                                guard(async () => {
                                  await api.approve(state.mission.missionId, { decision, reason, actorId });
                                  await refreshNow();
                                })
                              }
                            />
                          </div>
                        ) : null
                      }
                    />
                  ) : activeId ? (
                    <div className="grid h-full place-items-center text-ink-400">Loading conversation…</div>
                  ) : (
                    <div className="scroll-thin h-full overflow-y-auto">
                      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
                        <div className="flex animate-rise gap-4">
                          <Avatar agent="LEM3ALEM" size={48} />
                          <div className="min-w-0">
                            <div className="mb-1.5 text-sm font-bold text-gold">Lem3alem <span className="ml-1 text-[11px] font-normal tracking-wide text-ink-400 uppercase">Coordinator</span></div>
                            <div className="rounded-3xl rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-5 py-4 text-[15px] leading-relaxed">
                              Hi, I&apos;m Lem3alem, EL JOKER&apos;s coordinator. Tell me what your mission needs: who, where, what and the budget. Lemhaf will research suppliers, Nasnes will verify the evidence, 3ases will apply the spending rules, Kanawita will pay only if authorized, and Hedera will prove every step.
                              <span className="mt-3 block text-ink-300">A ready-made request is already in the message box — press send to launch the mission, or pick another scenario below.</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-white/[0.07] px-5 py-4">
                {notice && (
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold">
                    <span>{notice}</span>
                    <button type="button" className="text-xs text-ink-400 hover:text-white" onClick={() => setNotice(null)}>dismiss</button>
                  </div>
                )}
                {error && <div className="mb-3 rounded-2xl border border-tn-red/50 bg-tn-red/10 px-4 py-2 text-sm text-[#ff9aa3]">{error}</div>}
                <ChatComposer text={draft} onText={setDraft} scenarios={scenarios} selected={selected} onPick={pick} onSend={send} disabled={launching} showChips={!state || !state.busy} />
              </div>
            </section>

            {/* Live dashboard */}
            <aside className="scroll-thin hidden min-h-0 flex-col gap-5 overflow-y-auto pr-1 xl:flex">
              {state ? (
                <>
                  <KpiStrip state={state} className="grid grid-cols-2 gap-3" />
                  <ProofFeed state={state} config={config} />
                  <Panel title="Actions">
                    <div className="grid gap-3 p-5">
                      <Button
                        variant="ghost"
                        disabled={state.auditEvents.length === 0}
                        onClick={() =>
                          guard(async () => {
                            await api.verify(state.mission.missionId);
                            await refreshNow();
                            setView("proof");
                          })
                        }
                      >
                        🔎 Verify against Hedera
                      </Button>
                      <Button
                        variant="danger"
                        disabled={state.mission.status !== "PAID" || state.busy}
                        title="Sends exactly the same payment request again"
                        onClick={() =>
                          guard(async () => {
                            const r = await api.replay(state.mission.missionId);
                            setNotice(r.executed ? "Unexpected: replay executed" : `Replay rejected by Kanawita: ${r.reasons[0] ?? ""}`);
                            await refreshNow();
                          })
                        }
                      >
                        🔁 Replay payment (attack)
                      </Button>
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel title="How it works">
                  <ol className="grid gap-4 p-5 text-sm text-ink-300">
                    {[
                      ["LEM3ALEM", "Turns your request into a validated mission."],
                      ["LEMHAF", "AI researches and ranks supplier offers."],
                      ["NASNES", "Independently verifies registry, evidence and claims."],
                      ["3ASES", "Deterministic policy decides — no LLM."],
                      ["KANAWITA", "Pays on Hedera testnet only when authorized."],
                    ].map(([id, text]) => (
                      <li key={id} className="flex items-center gap-3">
                        <Avatar agent={id as "LEM3ALEM"} size={40} />
                        <span>{text}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/agents/hedera.png" alt="" className="h-10 w-10 rounded-full" />
                      <span>Hedera records a tamper-evident proof of every decision.</span>
                    </li>
                  </ol>
                </Panel>
              )}
            </aside>
          </>
        ) : (
          <section className="scroll-thin min-h-0 overflow-y-auto xl:col-span-2">
            {view === "audit" ? (
              <Panel title="Hash-linked audit trail">
                <AuditTimeline state={state} />
              </Panel>
            ) : (
              <Panel title="Proof & verification">
                <ProofVerify
                  state={state}
                  config={config}
                  onVerify={() =>
                    guard(async () => {
                      await api.verify(state.mission.missionId);
                      await refreshNow();
                    })
                  }
                  onTamper={async (mode) => {
                    let out = null;
                    await guard(async () => {
                      out = await api.tamper(state.mission.missionId, mode);
                      await refreshNow();
                    });
                    return out;
                  }}
                />
              </Panel>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
