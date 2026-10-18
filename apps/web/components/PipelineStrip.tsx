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
      const p = s.payments.find((x) => x.status !== "FAILED" && x.status !== "CANCELLED") ?? s.payments[0];
      if (p?.status === "CONFIRMED") return { st: "done", note: p.mode === "SIMULATED" ? "paid (simulated)" : "paid on testnet" };
      if (p?.status === "FAILED") return { st: "blocked", note: "payment failed" };
      if (["BLOCKED", "REJECTED"].includes(m.status)) return { st: "blocked", note: "no payment" };
      if (m.status === "HUMAN_REVIEW") return { st: "review", note: p?.status === "SCHEDULED" ? "locked in vault" : "on hold" };
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

/** Compact pipeline for the chat header. */
export function PipelineStrip({ state }: { state: MissionState | null }) {
  const anchored = state?.auditEvents.filter((e) => e.anchor.status === "ANCHORED" || e.anchor.status === "SIMULATED").length ?? 0;
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      {PIPELINE.map((id, i) => {
        const a = AGENTS[id];
        const { st, note } = agentState(id, state);
        const b = BADGE[st];
        return (
          <div key={id} className="flex shrink-0 items-center gap-1">
            <div className={cx("flex items-center gap-2 rounded-2xl px-2 py-1.5 transition", st === "active" && "bg-indigo/15", st === "idle" && "opacity-45")} title={`${a.name} — ${note}`}>
              <div className="relative">
                <Avatar agent={id} size={36} active={st === "active"} />
                {b && <span className={cx("absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-black ring-2 ring-black", b.c)}>{b.t}</span>}
              </div>
              <div className="hidden leading-tight min-[1900px]:block">
                <div className="text-[12px] font-bold" style={{ color: a.color }}>{a.name}</div>
                <div className="max-w-[92px] truncate text-[11px] text-ink-400">{note}</div>
              </div>
            </div>
            {i < PIPELINE.length - 1 && <span className="text-[10px] text-ink-600">›</span>}
          </div>
        );
      })}
      <span className="text-[10px] text-ink-600">›</span>
      <div className="flex shrink-0 items-center gap-2 rounded-2xl px-2 py-1.5" title={`${anchored} proofs anchored`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/agents/hedera.png" alt="Hedera" className="h-9 w-9 rounded-full ring-2 ring-[#8b80ff]" draggable={false} />
        <div className="hidden leading-tight min-[1900px]:block">
          <div className="text-[12px] font-bold text-white">Hedera</div>
          <div className="text-[11px] text-ink-400">{anchored} anchored</div>
        </div>
      </div>
    </div>
  );
}
