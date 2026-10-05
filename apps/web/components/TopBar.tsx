"use client";
import type { MissionSummary, PublicConfig } from "@eljoker/shared";
import { cx, usd } from "@/lib/format";
import { Chip, ExtLink } from "./ui";

export type View = "conversation" | "audit" | "proof";

export function TopBar(props: {
  config: PublicConfig | null;
  view: View;
  onView: (v: View) => void;
  hasMission: boolean;
  missions: MissionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { config } = props;
  const live = config?.hedera.mode === "LIVE_TESTNET";
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3.5">
        <button type="button" onClick={props.onNew} className="flex items-center gap-3 text-left">
          <div className="relative grid h-11 w-8 place-items-center rounded-md bg-ink-100 text-ink-950 shadow-[0_0_0_2px_#5b4bff,0_6px_24px_-4px_#5b4bff]">
            <span className="absolute top-0.5 left-1 text-[8px] font-bold text-tn-red">J</span>
            <span className="text-lg" aria-hidden>🃏</span>
          </div>
          <div>
            <div className="font-display text-lg leading-none font-bold tracking-tight">
              EL JOKER <span className="text-indigo">2.0</span>
            </div>
            <div className="mt-1 text-[11px] tracking-[0.18em] text-gold uppercase">5aliha 3lina</div>
          </div>
        </button>

        {props.hasMission && (
          <nav className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
            {([
              ["conversation", "Conversation"],
              ["audit", "Audit trail"],
              ["proof", "Proof & verify"],
            ] as [View, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => props.onView(k)}
                className={cx("rounded-xl px-4 py-2 text-sm font-semibold transition", props.view === k ? "bg-indigo text-white shadow-[0_0_20px_-6px_#5b4bff]" : "text-ink-300 hover:text-white")}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {config && (
            <>
              <Chip label={config.ai.configured ? `AI · ${config.ai.model}` : "AI · fallback"} tone={config.ai.configured ? "violet" : "amber"} />
              <Chip label={live ? `Hedera testnet · ${config.hedera.topicId}` : "Hedera · simulated"} tone={live ? "green" : "amber"} />
              {live && <ExtLink href={config.hedera.topicHashscanUrl}>topic</ExtLink>}
            </>
          )}
          {props.missions.length > 0 && (
            <select
              aria-label="Mission history"
              value={props.activeId ?? ""}
              onChange={(e) => (e.target.value ? props.onSelect(e.target.value) : props.onNew())}
              className="max-w-[220px] rounded-xl border border-white/10 bg-ink-900 px-3 py-2 text-xs text-ink-100"
            >
              <option value="">＋ New mission</option>
              {props.missions.map((m) => (
                <option key={m.missionId} value={m.missionId}>
                  {m.scenarioId ? `${m.scenarioId.slice(0, 1)} · ` : ""}
                  {m.location} · {usd(m.maximumBudget)} · {m.status.replace("_", " ")}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </header>
  );
}
