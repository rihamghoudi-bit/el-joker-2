"use client";
import type { MissionState, MissionSummary, PublicConfig, ScenarioInfo } from "@eljoker/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx, usd } from "@/lib/format";
import { AgentLineup } from "./AgentLineup";
import { ApprovalCard } from "./ApprovalCard";
import { AuditTimeline } from "./AuditTimeline";
import { ChatFeed } from "./ChatFeed";
import { Header } from "./Header";
import { ProofVerify } from "./ProofVerify";
import { Sidebar } from "./Sidebar";
import { missionChip, StatusBoard } from "./StatusBoard";
import { Button, Chip, Panel } from "./ui";

type Tab = "chat" | "audit" | "proof";
const ACTIVE = ["CREATED", "RESEARCHING", "VERIFYING", "EVALUATING", "APPROVED", "PAYING"];

export function MissionControl() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<MissionState | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
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
          if (m[0]) setActiveId((cur) => cur ?? m[0]!.missionId);
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

  // Keep the mission list in sync with status changes.
  const statusKey = state ? `${state.mission.missionId}:${state.mission.status}` : "";
  useEffect(() => {
    if (statusKey) void refreshList();
  }, [statusKey, refreshList]);

  const select = (id: string) => {
    setState(null);
    setActiveId(id);
    setTab("chat");
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

  const scenarioLetter = state?.mission.scenarioId?.slice(0, 1);
  const mission = state?.mission;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col">
      <Header config={config} />
      {apiDown && (
        <div className="mx-5 mt-3 rounded-xl border border-tn-red/50 bg-tn-red/10 px-4 py-2 text-sm text-[#ff9aa3]">
          API not reachable on :4000. Start it with <code className="font-mono">npm run dev</code> from the repo root.
        </div>
      )}
      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        <Sidebar
          scenarios={scenarios}
          missions={missions}
          activeId={activeId}
          launching={launching}
          onRunScenario={runScenario}
          onSubmitText={submitText}
          onSelect={select}
          onReset={
            config?.demoMode
              ? () =>
                  guard(async () => {
                    await api.reset();
                    setState(null);
                    setActiveId(null);
                    await refreshList();
                  })
              : null
          }
        />

        <section className="flex min-h-[78vh] min-w-0 flex-col gap-3 xl:h-[calc(100vh-110px)] xl:min-h-[720px]">
          <Panel className="p-3">
            {mission ? (
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
                {scenarioLetter && <span className="rounded-md bg-gold px-2 py-0.5 font-display text-sm font-bold text-ink-950">Scenario {scenarioLetter}</span>}
                <span className="font-display text-lg font-semibold">{mission.location}</span>
                <span className="text-sm text-ink-300">{usd(mission.maximumBudget)} budget</span>
                <span className="text-sm text-ink-300">{mission.beneficiaries.toLocaleString("en-US")} people</span>
                <Chip label={missionChip(mission.status)} className="ml-auto" />
                {state?.lastVerification && <Chip label={state.lastVerification.overall === "VALID" ? "PROOF VERIFIED" : state.lastVerification.overall.replace("_", " ")} />}
              </div>
            ) : (
              <div className="mb-3 px-1 text-sm text-ink-400">Pick a scenario on the left — the agents will take it from there.</div>
            )}
            <AgentLineup state={state} />
          </Panel>

          {notice && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold">
              <span>{notice}</span>
              <button type="button" className="text-xs text-ink-400 hover:text-ink-100" onClick={() => setNotice(null)}>dismiss</button>
            </div>
          )}
          {error && <div className="rounded-xl border border-tn-red/50 bg-tn-red/10 px-4 py-2 text-sm text-[#ff9aa3]">{error}</div>}

          <Panel className="flex min-h-[480px] flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-1 border-b border-ink-700/70 px-2 pt-2">
              {([
                ["chat", "💬 Mission room"],
                ["audit", `⛓ Audit timeline${state ? ` (${state.auditEvents.length})` : ""}`],
                ["proof", "🔐 Proof & verify"],
              ] as [Tab, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cx("rounded-t-lg px-3.5 py-2 text-sm font-semibold transition", tab === k ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-100")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="pattern relative min-h-0 flex-1 overflow-hidden bg-ink-900/40">
              {!state ? (
                <div className="grid h-full min-h-[50vh] place-items-center p-8 text-center">
                  <div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/agents/team.webp" alt="Lem3alem, Lemhaf, Kanawita, Nasnes and 3ases" className="mx-auto w-full max-w-xl rounded-2xl shadow-[0_10px_40px_-15px_rgba(231,0,19,0.5)]" />
                    <p className="mt-3 font-display text-xl font-bold">AI proposes. Nasnes verifies. 3ases decides. Humans control. Hedera proves.</p>
                    <p className="mt-1 text-sm text-ink-400">Launch scenario A to watch the five agents work.</p>
                  </div>
                </div>
              ) : tab === "chat" ? (
                <div className="absolute inset-0">
                  <ChatFeed state={state} />
                </div>
              ) : (
                <div className="scroll-thin absolute inset-0 overflow-y-auto">
                  {tab === "audit" ? (
                    <AuditTimeline state={state} />
                  ) : (
                    <ProofVerify
                      state={state}
                      config={config}
                      onVerify={() => guard(async () => {
                        await api.verify(state.mission.missionId);
                        await refreshNow();
                      })}
                      onTamper={async (mode) => {
                        let out = null;
                        await guard(async () => {
                          out = await api.tamper(state.mission.missionId, mode);
                          await refreshNow();
                        });
                        return out;
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </Panel>
        </section>

        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1">
          {state && state.mission.status === "HUMAN_REVIEW" && (
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
          )}
          {state && <StatusBoard state={state} config={config} />}
          {state && (
            <Panel title="Actions">
              <div className="grid gap-2 p-3">
                <Button
                  variant="danger"
                  disabled={state.mission.status !== "PAID" || state.busy}
                  title="Sends exactly the same payment request again"
                  onClick={() =>
                    guard(async () => {
                      const r = await api.replay(state.mission.missionId);
                      setNotice(r.executed ? "Unexpected: replay executed" : `Replay rejected by KANAWITA: ${r.reasons[0] ?? ""}`);
                      await refreshNow();
                    })
                  }
                >
                  🔁 Replay payment (attack)
                </Button>
                <Button variant="ghost" disabled={state.auditEvents.length === 0} onClick={() => setTab("proof")}>
                  🔐 Open proof & verification
                </Button>
                <p className="text-[11px] leading-snug text-ink-400">
                  The replay goes through the same KANAWITA checks as any payment. It is expected to be rejected (idempotency + one live payment per mission, enforced by the database).
                </p>
              </div>
            </Panel>
          )}
        </aside>
      </main>
      <footer className="px-5 pb-4 text-center text-[11px] text-ink-600">
        Hackathon prototype · Hedera testnet only · suppliers are fictional demo data · no real users, NGOs or partnerships are implied.
      </footer>
    </div>
  );
}
