"use client";
import type { ScenarioInfo } from "@eljoker/shared";
import { useState } from "react";
import { Button } from "./ui";

const LETTER_COLORS: Record<string, string> = { A: "#22c55e", B: "#e70013", C: "#f59e0b", D: "#a78bfa", E: "#2ea3f2", F: "#f5b700" };

export function Composer({ onSend, disabled, compact = false }: { onSend: (text: string) => void; disabled: boolean; compact?: boolean }) {
  const [text, setText] = useState("");
  const send = () => {
    if (text.trim().length < 10) return;
    onSend(text.trim());
    setText("");
  };
  return (
    <div className={compact ? "flex items-end gap-3" : "glass flex items-end gap-3 rounded-3xl p-3"}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        rows={compact ? 1 : 3}
        placeholder="Describe the emergency: who, where, what is needed, budget… e.g. 300 people in Sfax need water and hygiene kits, budget $3,000, within 48 hours"
        className={
          compact
            ? "min-h-[48px] flex-1 resize-none rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-[15px] text-ink-100 placeholder:text-ink-400 focus:border-indigo focus:outline-none"
            : "flex-1 resize-none bg-transparent px-3 py-2 text-lg text-ink-100 placeholder:text-ink-400 focus:outline-none"
        }
      />
      <Button disabled={disabled || text.trim().length < 10} onClick={send} className={compact ? "h-12" : "h-14 px-7 text-base"}>
        Send ➜
      </Button>
    </div>
  );
}

export function Hero({ scenarios, launching, onRunScenario, onSend }: { scenarios: ScenarioInfo[]; launching: string | null; onRunScenario: (id: string) => void; onSend: (text: string) => void }) {
  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col items-center gap-12 px-6 py-16 lg:py-24">
      <div className="text-center">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo/40 bg-indigo/10 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-[#b9b2ff] uppercase">
          Verifiable AI procurement · Hedera
        </p>
        <h1 className="font-display text-5xl leading-[1.05] font-bold tracking-tight md:text-7xl">
          Autonomous,
          <br />
          <span className="bg-gradient-to-r from-[#8b80ff] via-[#5b4bff] to-[#67e8f9] bg-clip-text text-transparent">but never uncontrolled.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-300">
          Send a request. Five agents research, verify and decide — a deterministic guardian controls the money, humans approve high-risk spending, and every decision is proven on Hedera.
        </p>
      </div>

      <div className="w-full max-w-3xl">
        <Composer onSend={onSend} disabled={launching !== null} />
      </div>

      <div className="w-full">
        <div className="mb-4 text-center text-xs font-semibold tracking-[0.18em] text-ink-400 uppercase">Or run a live demo scenario</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Scenario ${s.letter}: ${s.title}`}
              disabled={launching !== null}
              onClick={() => onRunScenario(s.id)}
              className="glass group flex items-start gap-4 rounded-3xl p-5 text-left transition hover:-translate-y-0.5 hover:border-indigo/60 disabled:opacity-50"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold text-black" style={{ background: LETTER_COLORS[s.letter] }}>
                {launching === s.id ? "…" : s.letter}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold text-white">{s.title}</span>
                <span className="mt-1 block text-sm leading-snug text-ink-400">{s.pitch}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/agents/team.webp" alt="Lem3alem, Lemhaf, Kanawita, Nasnes and 3ases" className="w-full max-w-2xl rounded-3xl opacity-95 shadow-[0_30px_80px_-30px_rgba(91,75,255,0.7)]" />
    </section>
  );
}
