"use client";
import type { MissionState, MissionSummary, PublicConfig, ScenarioInfo } from "@eljoker/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type TamperMode, type TamperResult } from "./api";
import { ACTIVE_STATUSES } from "./status";

export type View = "conversation" | "audit" | "proof";

/** All data + actions for the mission UI (loading, polling, sending, approvals, verification). */
export function useMissionControl() {
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
  // Off-chain evidence payloads are only fetched for the audit view.
  const wantPayloads = view === "audit";

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

  // Poll the active mission: fast while agents work or proofs are pending, slower when idle.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.mission(activeId, wantPayloads);
        if (stop || activeRef.current !== activeId) return;
        setState(s);
        setApiDown(false);
        const fast = s.busy || ACTIVE_STATUSES.includes(s.mission.status) || s.auditEvents.some((e) => e.anchor.status === "PENDING");
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
  }, [activeId, wantPayloads]);

  const statusKey = state ? `${state.mission.missionId}:${state.mission.status}` : "";
  useEffect(() => {
    if (statusKey) void refreshList();
  }, [statusKey, refreshList]);

  const open = useCallback((id: string) => {
    setState(null);
    setActiveId(id);
    setView("conversation");
    setNotice(null);
    setError(null);
  }, []);

  const newChat = useCallback(() => {
    setActiveId(null);
    setState(null);
    setView("conversation");
    setNotice(null);
    setError(null);
    if (scenarios[0]) pick(scenarios[0]);
  }, [scenarios, pick]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.message}${e.code ? ` (${e.code})` : ""}` : "Request failed — is the API running on :4000?");
    }
  }, []);

  const refreshNow = useCallback(async () => {
    const id = activeRef.current;
    if (id) setState(await api.mission(id, wantPayloads));
  }, [wantPayloads]);

  /** An untouched scenario request runs that scenario; anything else is sent as a free-text mission. */
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

  const approve = (decision: "APPROVED" | "REJECTED", reason: string, actorId: string, pin: string) =>
    guard(async () => {
      if (!state) return;
      await api.approve(state.mission.missionId, { decision, reason, actorId, pin });
      await refreshNow();
    });

  const verify = (thenShowProof = false) =>
    guard(async () => {
      if (!state) return;
      await api.verify(state.mission.missionId);
      await refreshNow();
      if (thenShowProof) setView("proof");
    });

  const replay = () =>
    guard(async () => {
      if (!state) return;
      const r = await api.replay(state.mission.missionId);
      setNotice(r.executed ? "Unexpected: replay executed" : `Replay rejected by Kanawita: ${r.reasons[0] ?? ""}`);
      await refreshNow();
    });

  const tamper = async (mode: TamperMode): Promise<TamperResult | null> => {
    let out: TamperResult | null = null;
    await guard(async () => {
      if (!state) return;
      out = await api.tamper(state.mission.missionId, mode);
      await refreshNow();
    });
    return out;
  };

  return {
    config, scenarios, missions, activeId, state, view, setView, draft, setDraft, selected, pick, launching, error, apiDown, notice, setNotice,
    open, newChat, send, approve, verify, replay, tamper,
  };
}

export type MissionControlModel = ReturnType<typeof useMissionControl>;
