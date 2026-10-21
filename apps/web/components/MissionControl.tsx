"use client";
import { useState } from "react";
import { useMotion } from "@/lib/motion";
import { useMissionControl } from "@/lib/useMissionControl";
import { AuditTimeline } from "./AuditTimeline";
import { Backdrop } from "./Backdrop";
import { ConversationPanel } from "./ConversationPanel";
import { Dashboard } from "./Dashboard";
import { HistoryList } from "./HistoryList";
import { Landing } from "./Landing";
import { ProofVerify } from "./ProofVerify";
import { TopBar } from "./TopBar";
import { Panel } from "./ui";

/** Two pages: a simple landing, then the chat-style mission room. */
export function MissionControl() {
  const [page, setPage] = useState<"home" | "chat">("home");
  const [motion, toggleMotion] = useMotion();
  const m = useMissionControl();
  const { state, view } = m;

  if (page === "home") {
    return (
      <div className="relative isolate flex min-h-screen flex-col">
        <Backdrop mascots />
        <Landing onEnter={() => setPage("chat")} />
      </div>
    );
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col xl:h-screen xl:overflow-hidden">
      <Backdrop />
      <TopBar config={m.config} view={view} onView={m.setView} hasMission={!!state} onHome={() => setPage("home")} motion={motion} onToggleMotion={toggleMotion} />

      {m.apiDown && (
        <div className="mx-5 mt-3 rounded-2xl border border-tn-red/50 bg-tn-red/10 px-5 py-2.5 text-sm text-[#ff9aa3]" role="alert">
          API not reachable on :4000 — start it with <code className="font-mono">npm run dev</code>. Retrying…
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1680px] flex-1 gap-5 px-5 py-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:min-h-0 xl:grid-rows-1 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
        <HistoryList missions={m.missions} activeId={m.activeId} onOpen={m.open} onNew={m.newChat} />

        {view === "conversation" || !state ? (
          <>
            <ConversationPanel m={m} />
            <aside className="scroll-thin flex min-w-0 flex-col gap-5 lg:col-start-2 xl:col-start-auto xl:min-h-0 xl:overflow-y-auto xl:pr-1" aria-label="Live mission dashboard">
              <Dashboard state={state} config={m.config} onVerify={() => m.verify(true)} onReplay={m.replay} />
            </aside>
          </>
        ) : (
          <section className="scroll-thin min-w-0 xl:col-span-2 xl:min-h-0 xl:overflow-y-auto">
            {view === "audit" ? (
              <Panel title="Hash-linked audit trail">
                <AuditTimeline state={state} />
              </Panel>
            ) : (
              <Panel title="Proof & verification">
                <ProofVerify state={state} config={m.config} onVerify={() => m.verify(false)} onTamper={m.tamper} />
              </Panel>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
