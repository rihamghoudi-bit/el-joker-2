/**
 * Floating glass-slab backdrop: electric-indigo panels drifting in 3D perspective over a black void.
 * Pure CSS (no canvas, no video). Decorative only; honors prefers-reduced-motion via globals.css.
 */

// x/y in % of the tilted plane, w/h in px, z = height above the plane, d = float delay
const SLABS = [
  { x: 8, y: 6, w: 520, h: 150, z: 120, d: 0 },
  { x: 46, y: 2, w: 240, h: 60, z: 210, d: -3 },
  { x: 70, y: 12, w: 200, h: 54, z: 160, d: -6 },
  { x: 22, y: 26, w: 600, h: 190, z: 60, d: -2 },
  { x: 40, y: 24, w: 220, h: 64, z: 230, d: -8 },
  { x: 62, y: 38, w: 260, h: 70, z: 140, d: -5 },
  { x: 14, y: 46, w: 640, h: 200, z: 20, d: -1 },
  { x: 4, y: 62, w: 220, h: 56, z: 180, d: -7 },
  { x: 56, y: 60, w: 210, h: 54, z: 90, d: -4 },
  { x: 30, y: 74, w: 260, h: 64, z: 150, d: -9 },
  { x: 66, y: 78, w: 230, h: 60, z: 40, d: -2.5 },
  { x: 10, y: 86, w: 280, h: 68, z: 110, d: -6.5 },
  { x: 78, y: 54, w: 180, h: 50, z: 250, d: -3.5 },
  { x: 84, y: 26, w: 300, h: 80, z: 70, d: -10 },
];

const MASCOTS = [
  { src: "/agents/lem3alem.webp", name: "Lem3alem", left: "9%", top: "20%", size: 120, dur: "9s", delay: "0s", color: "#f5b700" },
  { src: "/agents/lemhaf.webp", name: "Lemhaf", left: "80%", top: "16%", size: 110, dur: "11s", delay: "-3s", color: "#a78bfa" },
  { src: "/agents/nasnes.webp", name: "Nasnes", left: "14%", top: "66%", size: 104, dur: "10s", delay: "-6s", color: "#2dd4bf" },
  { src: "/agents/3ases.webp", name: "3ases", left: "77%", top: "62%", size: 124, dur: "12s", delay: "-2s", color: "#e70013" },
  { src: "/agents/kanawita.webp", name: "Kanawita", left: "46%", top: "80%", size: 96, dur: "10.5s", delay: "-5s", color: "#22c55e" },
  { src: "/agents/hedera.png", name: "Hedera", left: "60%", top: "6%", size: 64, dur: "13s", delay: "-8s", color: "#8b80ff" },
];

export function Backdrop({ mascots = false }: { mascots?: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black" aria-hidden>
      <div className="slab-stage absolute inset-0">
        <div className="slab-plane">
          {SLABS.map((s, i) => (
            <div
              key={i}
              className="slab"
              style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.w, height: s.h, ["--z" as string]: `${s.z}px`, animationDelay: `${s.d}s` }}
            >
              <span className="slab-line" />
            </div>
          ))}
        </div>
      </div>
      {/* keep content readable */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(0,0,0,0.25),rgba(0,0,0,0.75))]" />
      {mascots &&
        MASCOTS.map((m) => (
          <div key={m.name} className="mascot absolute" style={{ left: m.left, top: m.top, animationDuration: m.dur, animationDelay: m.delay }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.src}
              alt=""
              width={m.size}
              height={m.size}
              className="rounded-full ring-2"
              style={{ ["--tw-ring-color" as string]: m.color, boxShadow: `0 0 50px -8px ${m.color}` }}
              draggable={false}
            />
          </div>
        ))}
    </div>
  );
}
