"use client";
import type { PublicConfig } from "@eljoker/shared";
import { cx } from "@/lib/format";
import type { View } from "@/lib/useMissionControl";
import { Logo } from "./Logo";
import { Chip, ExtLink } from "./ui";


export function TopBar(props: { config: PublicConfig | null; view: View; onView: (v: View) => void; hasMission: boolean; onHome: () => void; motion: boolean; onToggleMotion: () => void }) {
  const { config } = props;
  const live = config?.hedera.mode === "LIVE_TESTNET";
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        <button type="button" onClick={props.onHome} className="flex items-center gap-3 text-left" aria-label="EL JOKER home">
          <Logo size={40} />
          <div>
            <div className="font-display text-lg leading-none font-bold tracking-tight">
              EL JOKER <span className="text-indigo">2.0</span>
            </div>
            <div className="mt-1 text-[11px] tracking-[0.18em] text-gold uppercase">5aliha 3lina</div>
          </div>
        </button>

        {props.hasMission && (
          <nav className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1" aria-label="Mission views">
            {([
              ["conversation", "Conversation"],
              ["audit", "Audit trail"],
              ["proof", "Proof & verify"],
            ] as [View, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-current={props.view === k ? "page" : undefined}
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
          <button
            type="button"
            onClick={props.onToggleMotion}
            aria-pressed={!props.motion}
            title="Turn background animation and blur on/off (smoother on projectors)"
            className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-ink-300 transition hover:border-white/25 hover:text-white"
          >
            {props.motion ? "Motion: on" : "Motion: off"}
          </button>
        </div>
      </div>
    </header>
  );
}
