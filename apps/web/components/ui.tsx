import type { ReactNode } from "react";
import { AGENTS } from "@/lib/agents";
import { cx } from "@/lib/format";
import type { AgentName } from "@eljoker/shared";

type Tone = "green" | "red" | "amber" | "blue" | "violet" | "gold" | "teal" | "gray";

const TONES: Record<Tone, string> = {
  green: "bg-mint/15 text-mint ring-mint/40",
  red: "bg-tn-red/15 text-[#ff5c6a] ring-tn-red/50",
  amber: "bg-amber/15 text-amber ring-amber/40",
  blue: "bg-sidi/15 text-sidi ring-sidi/40",
  violet: "bg-violet/15 text-violet ring-violet/40",
  gold: "bg-gold/15 text-gold ring-gold/40",
  teal: "bg-teal/15 text-teal ring-teal/40",
  gray: "bg-ink-700/60 text-ink-300 ring-ink-600",
};

/** Map any status label to a tone so chips stay consistent everywhere. */
export function toneFor(label: string): Tone {
  const l = label.toUpperCase();
  if (/TAMPER|BLOCK|REJECT|FAILED|REFUSED|ERROR|CRITICAL|INVALID|DUPLICATE/.test(l)) return "red";
  if (/REVIEW|HOLD|PENDING|NEEDS|HIGH|SIMULATED|FALLBACK|MEDIUM/.test(l)) return "amber";
  if (/PROOF VERIFIED|PAID|APPROVED|VERIFIED|VALID|LOW|ANCHORED|CONFIRMED|SUCCESS/.test(l)) return "green";
  if (/REAL AI|AI ANALYZING|RECOMMENDATION/.test(l)) return "violet";
  if (/NO LLM|DETERMINISTIC|EVALUATING|LOCKED|CO-SIGN|SIGNATURES|SCHEDULE/.test(l)) return "teal";
  if (/DEMO/.test(l)) return "gold";
  if (/PAYING|VERIFYING|RESEARCHING|CREATED|CHECKING/.test(l)) return "blue";
  return "gray";
}

const TONE_ICON: Partial<Record<Tone, string>> = { green: "✓", red: "✕", amber: "!" };

/** Status chip. Tone comes from the label; an icon repeats the meaning so it never relies on color alone. */
export function Chip({ label, tone, className }: { label: string; tone?: Tone; className?: string }) {
  const t = tone ?? toneFor(label);
  const icon = TONE_ICON[t];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset whitespace-nowrap", TONES[t], className)}>
      {icon && <span aria-hidden className="text-[10px]">{icon}</span>}
      {label}
    </span>
  );
}

export function Avatar({ agent, size = 36, active = false }: { agent: AgentName; size?: number; active?: boolean }) {
  const a = AGENTS[agent];
  return (
    <div
      className={cx("relative grid shrink-0 place-items-center overflow-hidden rounded-full ring-2", active && "animate-pulse-ring")}
      style={{ width: size, height: size, background: `color-mix(in srgb, ${a.color} 18%, #0b0b14)`, ["--tw-ring-color" as string]: a.color, ["--ring" as string]: a.color, fontSize: size * 0.48 }}
      title={`${a.name} — ${a.role}`}
    >
      {a.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.image} alt="" className="h-full w-full rounded-full object-cover" draggable={false} />
      ) : (
        <span aria-hidden>{a.glyph}</span>
      )}
    </div>
  );
}

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("glass rounded-3xl", className)}>
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
          <h2 className="font-display text-sm font-semibold tracking-[0.12em] text-ink-300 uppercase">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", className, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "danger" | "ghost" | "success" | "gold"; className?: string; title?: string }) {
  const styles = {
    primary: "bg-indigo text-white shadow-[0_0_24px_-6px_#5b4bff] hover:bg-indigo/90",
    danger: "bg-tn-red text-white hover:bg-tn-red/90",
    success: "bg-mint text-ink-950 hover:bg-mint/90",
    gold: "bg-gold text-ink-950 hover:bg-gold/90",
    ghost: "bg-ink-800 text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700",
  }[variant];
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={cx("inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40", styles, className)}>
      {children}
    </button>
  );
}

export function ExtLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sidi underline decoration-sidi/40 underline-offset-2 hover:decoration-sidi">
      {children} <span aria-hidden>↗</span>
    </a>
  );
}
