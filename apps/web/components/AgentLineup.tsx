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
      return s.recommendation ? { st: "done", note: run?.mode === "REAL_AI" ? "real AI pick" : "fallback pick" } : { st: "idle", note: "waiting" };
    }
    case "NASNES":
      if (!s.verification) return { st: "idle", note: "waiting" };
      return s.verification.status === "VERIFIED" ? { st: "done", note: "verified" } : { st: "blocked", note: s.verification.status.toLowerCase().replace("_", " ") };
    case "3ASES":
      if (!s.guardianDecision) return { st: "idle", note: "waiting" };
      return s.guardianDecision.decision === "APPROVED" ? { st: "done", note: "approved" } : s.guardianDecision.decision === "BLOCKED" ? { st: "blocked", note: "blocked" } : { st: "review", note: "human review" };
    case "KANAWITA": {
      const p = s.payments.find((x) => x.status !== "FAILED") ?? s.payments[0];
      if (p?.status === "CONFIRMED") return { st: "done", note: p.mode === "SIMULATED" ? "paid (simulated)" : "paid" };
      if (p?.status === "FAILED") return { st: "blocked", note: "payment failed" };
      if (["BLOCKED", "REJECTED"].includes(m.status)) return { st: "blocked", note: "no payment" };
      if (m.status === "HUMAN_REVIEW") return { st: "review", note: "on hold" };
      return { st: "idle", note: "waiting" };
    }
    default:
      return { st: "idle", note: "" };
  }
}

const RING: Record<St, string> = {
  idle: "border-ink-700 opacity-60",
  active: "border-gold bg-gold/5",
  done: "border-mint/50",
  blocked: "border-tn-red/70 bg-tn-red/5",
  review: "border-amber/70 bg-amber/5",
};
const BADGE: Record<St, string> = { idle: "", active: "⏳", done: "✓", blocked: "✕", review: "!" };

export function AgentLineup({ state }: { state: MissionState | null }) {
  const anchored = state?.auditEvents.filter((e) => e.anchor.status === "ANCHORED" || e.anchor.status === "SIMULATED").length ?? 0;
  const total = state?.auditEvents.length ?? 0;
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 2xl:grid-cols-6">
      {PIPELINE.map((id, i) => {
        const a = AGENTS[id];
        const { st, note } = agentState(id, state);
        return (
          <div key={id} className="relative min-w-0">
            <div className={cx("flex h-full items-center gap-2 rounded-xl border px-2.5 py-2 transition", RING[st])}>
              <Avatar agent={id} size={48} active={st === "active"} />
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[13px] leading-tight font-bold" style={{ color: a.color }}>
                  {a.name}
                  {BADGE[st] && <span className={cx("text-[11px]", st === "done" ? "text-mint" : st === "blocked" ? "text-[#ff5c6a]" : "text-amber")}>{BADGE[st]}</span>}
                </div>
                <div className="truncate text-[10.5px] text-ink-400 uppercase">{a.role}{id === "3ASES" ? " · no LLM" : a.usesAi ? " · AI" : ""}</div>
                <div className="truncate text-[11px] text-ink-300">{note}</div>
              </div>
            </div>
            {i < PIPELINE.length - 1 && <span className="absolute top-1/2 -right-[9px] z-10 hidden -translate-y-1/2 text-[10px] text-ink-600 2xl:block" aria-hidden>▶</span>}
          </div>
        );
      })}
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-sidi/40 px-2.5 py-2">
        <div className="grid h-[48px] w-[48px] shrink-0 place-items-center rounded-full bg-sidi/15 font-display text-2xl font-bold text-sidi ring-2 ring-sidi">ℏ</div>
        <div>
          <div className="text-[13px] leading-tight font-bold text-sidi">Hedera</div>
          <div className="text-[10.5px] text-ink-400 uppercase">proof layer</div>
          <div className="text-[11px] text-ink-300">{anchored}/{total} anchored</div>
        </div>
      </div>
    </div>
  );
}
