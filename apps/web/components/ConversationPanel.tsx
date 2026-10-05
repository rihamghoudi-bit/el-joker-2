"use client";
import type { MissionControlModel } from "@/lib/useMissionControl";
import { usd } from "@/lib/format";
import { missionChip } from "@/lib/status";
import { PipelineStrip } from "./PipelineStrip";
import { ApprovalCard } from "./ApprovalCard";
import { ChatComposer } from "./ChatComposer";
import { ChatFeed } from "./ChatFeed";
import { Avatar, Chip } from "./ui";

function Welcome() {
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <div className="flex animate-rise gap-4">
          <Avatar agent="LEM3ALEM" size={48} />
          <div className="min-w-0">
            <div className="mb-1.5 text-sm font-bold text-gold">
              Lem3alem <span className="ml-1 text-[11px] font-normal tracking-wide text-ink-400 uppercase">Coordinator</span>
            </div>
            <div className="rounded-3xl rounded-tl-md border border-white/[0.08] bg-white/[0.04] px-5 py-4 text-[15px] leading-relaxed">
              Hi, I&apos;m Lem3alem, EL JOKER&apos;s coordinator. Tell me what your mission needs: who, where, what and the budget. Lemhaf will research suppliers, Nasnes will verify the evidence, 3ases will apply the spending rules, Kanawita will pay only if authorized, and Hedera will prove every step.
              <span className="mt-3 block text-ink-300">A ready-made request is already in the message box — press send to launch the mission, or pick another scenario.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ChatGPT-style conversation: header with the agent pipeline, messages, inline approval, composer. */
export function ConversationPanel({ m }: { m: MissionControlModel }) {
  const { state, activeId } = m;
  const mission = state?.mission;
  const letter = mission?.scenarioId?.slice(0, 1);
  return (
    <section className="glass flex h-[82vh] min-h-[560px] flex-col overflow-hidden rounded-3xl xl:h-auto xl:min-h-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {mission ? (
            <>
              {letter && <span className="rounded-md bg-gold px-2 py-0.5 font-display text-[11px] font-bold text-black">{letter}</span>}
              <h1 className="truncate font-display text-base font-semibold">
                {mission.location} · {usd(mission.maximumBudget)} · {mission.beneficiaries.toLocaleString("en-US")} people
              </h1>
              <Chip label={missionChip(mission.status)} />
            </>
          ) : (
            <h1 className="font-display text-base font-semibold">New request</h1>
          )}
          {mission && (
            <button type="button" onClick={m.newChat} className="rounded-xl border border-white/10 px-2.5 py-1 text-xs text-ink-300 hover:text-white lg:hidden">
              ＋ New
            </button>
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
                  <div className="sm:ml-16">
                    <ApprovalCard state={state} config={m.config} onDecide={m.approve} />
                  </div>
                ) : null
              }
            />
          ) : activeId ? (
            <div className="grid h-full place-items-center text-ink-400">Loading conversation…</div>
          ) : (
            <Welcome />
          )}
        </div>
      </div>

      <div className="border-t border-white/[0.07] px-5 py-4 [@media(max-height:820px)]:py-2.5">
        {m.notice && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold" role="status">
            <span>{m.notice}</span>
            <button type="button" className="text-xs text-ink-400 hover:text-white" onClick={() => m.setNotice(null)}>
              dismiss
            </button>
          </div>
        )}
        {m.error && (
          <div className="mb-3 rounded-2xl border border-tn-red/50 bg-tn-red/10 px-4 py-2 text-sm text-[#ff9aa3]" role="alert">
            {m.error}
          </div>
        )}
        <ChatComposer text={m.draft} onText={m.setDraft} scenarios={m.scenarios} selected={m.selected} onPick={m.pick} onSend={m.send} disabled={m.launching} showChips={!state || !state.busy} />
      </div>
    </section>
  );
}
