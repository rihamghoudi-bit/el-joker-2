/** Simple landing: title, one sentence, one button. The agents float in the background. */
export function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo/40 bg-indigo/10 px-4 py-1.5 text-xs font-semibold tracking-[0.2em] text-[#b9b2ff] uppercase backdrop-blur">
        Chain619 · Hedera Hackathon
      </p>
      <h1 className="font-display text-6xl leading-none font-bold tracking-tight md:text-8xl">
        EL JOKER <span className="bg-gradient-to-r from-[#8b80ff] via-[#5b4bff] to-[#67e8f9] bg-clip-text text-transparent">2.0</span>
      </h1>
      <p className="mt-4 font-display text-xl tracking-[0.3em] text-gold uppercase">5aliha 3lina</p>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-ink-300 md:text-xl">
        Five agents handle your emergency procurement: one AI researcher recommends, four rule-based agents verify, decide and pay — humans approve high-risk spending, and every decision is proven on Hedera.
        <span className="mt-2 block font-semibold text-white">Autonomous, but never uncontrolled.</span>
      </p>
      <button
        type="button"
        onClick={onEnter}
        className="group mt-12 inline-flex items-center gap-3 rounded-2xl bg-indigo px-9 py-4 font-display text-lg font-bold text-white shadow-[0_0_50px_-8px_#5b4bff] transition hover:-translate-y-0.5 hover:shadow-[0_0_70px_-6px_#5b4bff]"
      >
        Go for EL JOKER <span className="transition group-hover:translate-x-1">➜</span>
      </button>
    </section>
  );
}
