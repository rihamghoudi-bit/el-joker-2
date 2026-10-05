/** EL JOKER mark: a playing card with a "J" and an indigo diamond (vector, no emoji). */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size * 0.72} height={size} viewBox="0 0 36 50" aria-hidden className="shrink-0 drop-shadow-[0_6px_18px_rgba(91,75,255,0.55)]">
      <defs>
        <linearGradient id="lg-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcd9ff" />
        </linearGradient>
        <linearGradient id="lg-gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b80ff" />
          <stop offset="1" stopColor="#5b4bff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="34" height="48" rx="5" fill="url(#lg-card)" stroke="#5b4bff" strokeWidth="2" />
      <text x="5" y="11" fontSize="8" fontWeight="800" fill="#e70013" fontFamily="system-ui, sans-serif">J</text>
      <text x="31" y="39" fontSize="8" fontWeight="800" fill="#e70013" fontFamily="system-ui, sans-serif" transform="rotate(180 31 39)">J</text>
      <path d="M18 14 L26 25 L18 36 L10 25 Z" fill="url(#lg-gem)" />
      <path d="M18 14 L26 25 L18 25 Z" fill="#ffffff" opacity="0.25" />
      <circle cx="18" cy="25" r="2" fill="#67e8f9" />
    </svg>
  );
}
