"use client";
import type { MissionSummary, ScenarioInfo } from "@eljoker/shared";
import { useState } from "react";
import { cx, usd } from "@/lib/format";
import { Button, Chip, Panel } from "./ui";

const LETTER_COLORS: Record<string, string> = { A: "#22c55e", B: "#e70013", C: "#f59e0b", D: "#a78bfa", E: "#2ea3f2", F: "#f5b700" };

export function Sidebar(props: {
  scenarios: ScenarioInfo[];
  missions: MissionSummary[];
  activeId: string | null;
  launching: string | null;
  onRunScenario: (id: string) => void;
  onSubmitText: (text: string) => void;
  onSelect: (id: string) => void;
  onReset: (() => void) | null;
}) {
  const [text, setText] = useState("");
  return (
    <aside className="flex min-h-0 flex-col gap-4">
      <Panel title="Live demo scenarios" right={<Chip label="Demo data" tone="gold" />}>
        <div className="grid gap-2 p-3">
          {props.scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={props.launching !== null}
              onClick={() => props.onRunScenario(s.id)}
              className="group flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-850 p-2.5 text-left transition hover:border-ink-500 hover:bg-ink-800 disabled:opacity-50"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg font-display text-base font-bold text-ink-950" style={{ background: LETTER_COLORS[s.letter] }}>
                {props.launching === s.id ? "…" : s.letter}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-100">{s.title}</span>
                <span className="block text-xs leading-snug text-ink-400">{s.pitch}</span>
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="New mission (free text)">
        <div className="grid gap-2 p-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. 300 people in Sfax need water and hygiene kits, budget $3,000, within 48 hours"
            className="w-full resize-none rounded-xl border border-ink-700 bg-ink-950/60 p-2.5 text-sm text-ink-100 placeholder:text-ink-400 focus:border-sidi focus:outline-none"
          />
          <Button
            disabled={text.trim().length < 10 || props.launching !== null}
            onClick={() => {
              props.onSubmitText(text.trim());
              setText("");
            }}
          >
            🎩 Send to Lem3alem
          </Button>
          <p className="text-[11px] leading-snug text-ink-400">Lem3alem never invents location, people, budget or items — missing facts return NEEDS INFORMATION.</p>
        </div>
      </Panel>

      <Panel title="Missions" right={props.onReset && <button type="button" onClick={props.onReset} className="text-[11px] text-ink-400 hover:text-tn-red">reset demo</button>} className="min-h-0 flex-1">
        <ul className="scroll-thin max-h-72 overflow-y-auto p-2">
          {props.missions.length === 0 && <li className="p-3 text-xs text-ink-400">No missions yet. Launch scenario A.</li>}
          {props.missions.map((m) => (
            <li key={m.missionId}>
              <button
                type="button"
                onClick={() => props.onSelect(m.missionId)}
                className={cx("w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-800", props.activeId === m.missionId && "bg-ink-800 ring-1 ring-ink-600")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-ink-100">{m.scenarioId ? `${m.scenarioId.slice(0, 1)} · ` : ""}{m.location}</span>
                  <Chip label={m.status.replace("_", " ")} />
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink-400">{usd(m.maximumBudget)} · {m.description}</div>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </aside>
  );
}
