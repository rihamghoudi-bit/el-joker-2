"use client";
import type { ScenarioInfo } from "@eljoker/shared";
import { cx } from "@/lib/format";

const LETTER_COLORS: Record<string, string> = { A: "#22c55e", B: "#e70013", C: "#f59e0b", D: "#a78bfa", E: "#2ea3f2", F: "#f5b700", G: "#2dd4bf" };

/**
 * ChatGPT-style input. The text is pre-filled with a ready-made request; the scenario chips swap it.
 * Sending an unchanged scenario request runs that scenario; edited text is sent as a free-text mission.
 */
export function ChatComposer(props: {
  text: string;
  onText: (t: string) => void;
  scenarios: ScenarioInfo[];
  selected: string | null;
  onPick: (s: ScenarioInfo) => void;
  onSend: () => void;
  disabled: boolean;
  showChips: boolean;
}) {
  const canSend = props.text.trim().length >= 10 && !props.disabled;
  return (
    <div className="grid gap-3">
      {props.showChips && props.scenarios.length > 0 && (
        <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
          {props.scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => props.onPick(s)}
              title={s.pitch}
              aria-label={`Scenario ${s.letter}: ${s.title}`}
              className={cx(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] whitespace-nowrap transition",
                props.selected === s.id ? "border-indigo bg-indigo/20 text-white" : "border-white/10 bg-white/[0.03] text-ink-300 hover:border-white/25 hover:text-white",
              )}
            >
              <span className="grid h-5 w-5 place-items-center rounded-md text-[11px] font-bold text-black" style={{ background: LETTER_COLORS[s.letter] }}>
                {s.letter}
              </span>
              {s.title}
            </button>
          ))}
        </div>
      )}
      <div className="glass flex items-end gap-3 rounded-3xl p-2.5 pl-5 focus-within:border-indigo/70">
        <textarea
          value={props.text}
          onChange={(e) => props.onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) props.onSend();
            }
          }}
          rows={2}
          placeholder="Message EL JOKER… who, where, what is needed, budget"
          className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-relaxed text-ink-100 placeholder:text-ink-400 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Send request"
          disabled={!canSend}
          onClick={props.onSend}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo text-xl text-white shadow-[0_0_24px_-6px_#5b4bff] transition hover:bg-indigo/90 disabled:opacity-30"
        >
          ↑
        </button>
      </div>
      <p className="text-center text-[11px] text-ink-400">AI recommends — it never authorizes money. 3ases decides with deterministic rules; every decision is anchored on Hedera.</p>
    </div>
  );
}
