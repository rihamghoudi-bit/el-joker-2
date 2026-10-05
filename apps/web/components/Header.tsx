import type { PublicConfig } from "@eljoker/shared";
import { Chip, ExtLink } from "./ui";

export function Header({ config }: { config: PublicConfig | null }) {
  const live = config?.hedera.mode === "LIVE_TESTNET";
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-700/70 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="relative grid h-12 w-9 place-items-center rounded-md bg-ink-100 text-ink-950 shadow-[0_0_0_2px_#e70013,0_6px_20px_-6px_#e70013]">
          <span className="absolute top-0.5 left-1 text-[9px] font-bold text-tn-red">J</span>
          <span className="text-xl" aria-hidden>🃏</span>
          <span className="absolute right-1 bottom-0.5 rotate-180 text-[9px] font-bold text-tn-red">J</span>
        </div>
        <div>
          <h1 className="font-display text-xl leading-none font-bold tracking-tight">
            EL JOKER <span className="text-tn-red">2.0</span> <span className="ml-1 text-gold">— 5ALIHA 3LINA</span>
          </h1>
          <p className="mt-1 text-xs text-ink-400">
            Chain619 · <span className="text-ink-300 italic">“Autonomous, but never uncontrolled.”</span>
          </p>
        </div>
      </div>
      {config && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip label={config.ai.configured ? `AI: REAL · ${config.ai.model}` : "AI: FALLBACK ONLY (no key)"} tone={config.ai.configured ? "violet" : "amber"} />
          <span className="inline-flex items-center gap-1.5">
            <Chip label={live ? `HEDERA TESTNET · ${config.hedera.topicId}` : "HEDERA: SIMULATED (no credentials)"} tone={live ? "green" : "amber"} />
            {live && <ExtLink href={config.hedera.topicHashscanUrl}>topic</ExtLink>}
          </span>
          <Chip label={`POLICY ${config.policy.version}`} tone="teal" />
          {config.demoMode && <Chip label="DEMO MODE" tone="gold" />}
        </div>
      )}
    </header>
  );
}
