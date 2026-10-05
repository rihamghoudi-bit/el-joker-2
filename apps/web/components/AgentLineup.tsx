import type { AgentName, MissionState } from "@eljoker/shared";
import { AGENTS, PIPELINE } from "@/lib/agents";
import { cx } from "@/lib/format";
import { Avatar } from "./ui";

type St = "idle" | "active" | "done" | "blocked" | "review";

function agentState(agent: AgentName, s: MissionState | null): { st: St; note: string } {
  if (!s) return { st: "idle", note: AGENTS[agent].tagline };
  if (s.currentAgent === agent) return { st: "active", note: "working…" };
  const m = s.mission;
  switch (agent) {
    case "LEM3ALEM":
      return m.status === "NEEDS_INFORMATION" ? { st: "blocked", note: "needs information" } : { st: "done", note: "mission planned" };
    case "LEMHAF": {
      const run = s.agentRuns.find((r) => r.agent === "LEMHAF");
      return s.recommendation ? { st: "done", note: run?.mode === "REAL_AI" ? "Claude recommendation" : "fallback ranking" } : { st: "idle", note: "waiting" };
    }
    case "NASNES":
      if (!s.verification) return { st: "idle", note: "waiting" };
      return s.verification.status === "VERIFIED" ? { st: "done", note: "evidence verified" } : { st: "blocked", note: s.verification.status.toLowerCase().replace("_", " ") };
    case "3ASES":
      if (!s.guardianDecision) return { st: "idle", note: "waiting" };
      return s.guardianDecision.decision === "APPROVED" ? { st: "done", note: "approved" } : s.guardianDecision.decision === "BLOCKED" ? { st: "blocked", note: "blocked" } : { st: "review", note: "human review" };
    case "KANAWITA": {
      const p = s.payments.find((x) => x.status !== "FAILED") ?? s.payments[0];
      if (p?.status === "CONFIRMED") return { st: "done", note: p.mode === "SIMULATED" ? "paid (simulated)" : "paid on testnet" };
      if (p?.status === "FAILED") return { st: "blocked", note: "payment failed" };
      if (["BLOCKED", "REJECTED"].includes(m.status)) return { st: "blocked", note: "no payment" };
      if (m.status === "HUMAN_REVIEW") return { st: "review", note: "on hold" };
      return { st: "idle", note: "waiting" };
    }
    default:
      return { st: "idle", note: "" };
  }
}

const BADGE: Record<St, { t: string; c: string } | null> = {
  idle: null,
  active: { t: "…", c: "bg-indigo text-white" },
  done: { t: "✓", c: "bg-mint" },
  blocked: { t: "✕", c: "bg-tn-red text-white" },
  review: { t: "!", c: "bg-amber" },
};

/** Big horizontal pipeline: who is working right now, who is done, who blocked. */
export function AgentLineup({ state }: { state: MissionState | null }) {
  const anchored = state?.auditEvents.filter((e) => e.anchor.status === "ANCHORED" || e.anchor.status === "SIMULATED").length ?? 0;
  const total = state?.auditEvents.length ?? 0;
  const states = PIPELINE.map((id) => agentState(id, state));
  const reached = states.reduce((n, s, i) => (s.st !== "idle" ? i + 1 : n), 0);

  return (
    <div className="glass relative rounded-3xl px-6 py-6">
      {/* progress rail behind the avatars */}
      <div className="absolute top-[58px] right-[8%] left-[8%] hidden h-[3px] rounded-full bg-white/[0.06] lg:block">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo to-cyan transition-all duration-700" style={{ width: `${Math.min(100, (reached / PIPELINE.length) * 100)}%` }} />
      </div>
      <div className="relative grid grid-cols-3 gap-y-6 lg:grid-cols-6">
        {PIPELINE.map((id, i) => {
          const a = AGENTS[id];
          const { st, note } = states[i]!;
          const b = BADGE[st];
          return (
            <div key={id} className={cx("flex flex-col items-center text-center transition", st === "idle" && "opacity-45")}>
              <div className="relative">
                <Avatar agent={id} size={68} active={st === "active"} />
                {b && <span className={cx("absolute -right-1 -bottom-1 grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-black ring-2 ring-black", b.c)}>{b.t}</span>}
              </div>
              <div className="mt-3 font-display text-base font-bold" style={{ color: a.color }}>{a.name}</div>
              <div className="text-[11px] tracking-[0.12em] text-ink-400 uppercase">{a.role}{id === "3ASES" ? " · no LLM" : ""}</div>
              <div className={cx("mt-1 text-[13px]", st === "blocked" ? "text-[#ff5c6a]" : st === "review" ? "text-amber" : st === "active" ? "text-[#b9b2ff]" : "text-ink-300")}>{note}</div>
            </div>
          );
        })}
        <div className="flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/agents/hedera.png" alt="Hedera" className="h-[68px] w-[68px] rounded-full shadow-[0_0_30px_-6px_#5b4bff] ring-2 ring-[#8b80ff]" draggable={false} />
          <div className="mt-3 font-display text-base font-bold text-white">Hedera</div>
          <div className="text-[11px] tracking-[0.12em] text-ink-400 uppercase">proof layer</div>
          <div className="mt-1 text-[13px] text-ink-300">{anchored}/{total} anchored</div>
        </div>
      </div>
    </div>
  );
}
