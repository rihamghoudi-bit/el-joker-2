/** EL JOKER mark: the jester over a locked vault (team logo, transparent PNG). */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/eljoker-mark.png"
      alt=""
      aria-hidden
      width={Math.round(size * 0.89)}
      height={size}
      className="shrink-0 drop-shadow-[0_6px_18px_rgba(138,43,226,0.45)]"
    />
  );
}
