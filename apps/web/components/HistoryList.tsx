import type { MissionSummary } from "@eljoker/shared";
import { cx, usd } from "@/lib/format";
import { missionChip } from "@/lib/status";
import { Button, Chip } from "./ui";

/** Chat-app style sidebar: new request + mission history. */
export function HistoryList({ missions, activeId, onOpen, onNew }: { missions: MissionSummary[]; activeId: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <aside className="hidden min-h-0 flex-col gap-3 lg:sticky lg:top-24 lg:row-span-2 lg:flex lg:max-h-[calc(100vh-7rem)] lg:self-start xl:static xl:max-h-none xl:self-stretch">
      <Button onClick={onNew} className="w-full">＋ New request</Button>
      <nav aria-label="Mission history" className="glass scroll-thin min-h-0 flex-1 overflow-y-auto rounded-3xl p-2">
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.16em] text-ink-400 uppercase">History</div>
        {missions.length === 0 && <p className="px-3 py-2 text-xs text-ink-400">No missions yet.</p>}
        {missions.map((m) => (
          <button
            key={m.missionId}
            type="button"
            onClick={() => onOpen(m.missionId)}
            aria-current={activeId === m.missionId ? "true" : undefined}
            aria-label={`${m.scenarioId ? `Scenario ${m.scenarioId.slice(0, 1)}, ` : ""}${m.location}, ${usd(m.maximumBudget)}, ${missionChip(m.status)}`}
            className={cx("w-full rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]", activeId === m.missionId && "bg-indigo/15 ring-1 ring-indigo/40")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-white">
                {m.scenarioId ? `${m.scenarioId.slice(0, 1)} · ` : ""}
                {m.location}
              </span>
              <Chip label={missionChip(m.status)} className="px-2 py-0.5 text-[9.5px]" />
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-ink-400">
              {usd(m.maximumBudget)} · {m.description}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
