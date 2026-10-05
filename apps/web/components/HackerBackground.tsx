"use client";
import { useEffect, useRef } from "react";

/**
 * Animated "synthwave hacker" backdrop: drifting nebula, twinkling stars, sparse hex code rain,
 * a rotating neon wireframe polyhedron, floating low-poly crystals and CRT scanlines.
 * Pure decoration: pointer-events none, sits behind everything, honors prefers-reduced-motion.
 */

const CRYSTALS = [
  { left: "6%", top: "12%", size: 70, delay: "0s", dur: "14s", hue: "#8b5cf6" },
  { left: "29%", top: "58%", size: 44, delay: "-4s", dur: "11s", hue: "#e11d74" },
  { left: "71%", top: "6%", size: 58, delay: "-7s", dur: "16s", hue: "#a855f7" },
  { left: "88%", top: "44%", size: 40, delay: "-2s", dur: "12s", hue: "#f43f5e" },
  { left: "79%", top: "82%", size: 64, delay: "-9s", dur: "18s", hue: "#d946ef" },
  { left: "46%", top: "22%", size: 30, delay: "-5s", dur: "10s", hue: "#fb7185" },
  { left: "15%", top: "84%", size: 36, delay: "-11s", dur: "13s", hue: "#c026d3" },
];

function Crystal({ size, hue }: { size: number; hue: string }) {
  // Low-poly gem: 4 facets with different shading.
  return (
    <svg width={size} height={size * 1.25} viewBox="0 0 40 50" aria-hidden>
      <polygon points="20,0 34,14 20,22" fill={hue} opacity="0.95" />
      <polygon points="20,0 6,14 20,22" fill={hue} opacity="0.7" />
      <polygon points="6,14 20,22 16,50" fill={hue} opacity="0.5" />
      <polygon points="34,14 20,22 16,50" fill={hue} opacity="0.8" />
      <polygon points="20,0 34,14 20,22" fill="#fff" opacity="0.18" />
    </svg>
  );
}

// Icosahedron (12 vertices, 30 edges) — reads as a neon "network node" wireframe.
const PHI = (1 + Math.sqrt(5)) / 2;
const VERTS: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const EDGES: [number, number][] = [];
for (let i = 0; i < VERTS.length; i++)
  for (let j = i + 1; j < VERTS.length; j++) {
    const [a, b] = [VERTS[i]!, VERTS[j]!];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (Math.abs(d - 2) < 0.01) EDGES.push([i, j]);
  }

export function HackerBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;

    type Star = { x: number; y: number; r: number; tw: number; sp: number };
    type Drop = { x: number; y: number; speed: number; chars: string[] };
    let stars: Star[] = [];
    let drops: Drop[] = [];
    const HEX = "0123456789abcdef";
    const randHex = () => HEX[Math.floor(Math.random() * 16)]!;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 5200) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.3 + 0.2, tw: Math.random() * Math.PI * 2, sp: Math.random() * 0.06 + 0.01 }));
      drops = Array.from({ length: Math.max(6, Math.round(w / 120)) }, () => ({ x: Math.floor(Math.random() * (w / 14)) * 14, y: Math.random() * h, speed: Math.random() * 40 + 25, chars: Array.from({ length: 14 }, randHex) }));
    };

    const draw = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      ctx.clearRect(0, 0, w, h);

      // Stars (slow upward drift + twinkle)
      for (const s of stars) {
        s.y -= s.sp * dt * 60;
        if (s.y < -2) s.y = h + 2;
        const a = 0.35 + 0.65 * Math.abs(Math.sin(s.tw + t / 900));
        ctx.fillStyle = `rgba(255,240,255,${a * 0.8})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hex code rain (sparse, faint teal)
      ctx.font = "12px ui-monospace, monospace";
      for (const d of drops) {
        d.y += d.speed * dt;
        if (d.y - d.chars.length * 14 > h) {
          d.y = -Math.random() * 200;
          d.x = Math.floor(Math.random() * (w / 14)) * 14;
        }
        if (Math.random() < 0.05) d.chars[Math.floor(Math.random() * d.chars.length)] = randHex();
        d.chars.forEach((c, i) => {
          const y = d.y - i * 14;
          if (y < -14 || y > h) return;
          ctx.fillStyle = i === 0 ? "rgba(190,255,250,0.55)" : `rgba(45,212,191,${0.22 * (1 - i / d.chars.length)})`;
          ctx.fillText(c, d.x, y);
        });
      }

      // Rotating neon wireframe (bottom-left, partly off-screen like the hero ship)
      const R = Math.min(w, h) * 0.32;
      const cx = w * 0.12;
      const cy = h * 0.92;
      const ay = t / 7000;
      const ax = t / 11000 + 0.5;
      const proj = VERTS.map(([x, y, z]) => {
        const x1 = x * Math.cos(ay) - z * Math.sin(ay);
        const z1 = x * Math.sin(ay) + z * Math.cos(ay);
        const y1 = y * Math.cos(ax) - z1 * Math.sin(ax);
        const z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
        const p = 3.2 / (4.5 - z2);
        return [cx + (x1 * R * p) / PHI, cy + (y1 * R * p) / PHI, z2] as const;
      });
      ctx.lineWidth = 1.4;
      ctx.shadowColor = "#2dd4bf";
      ctx.shadowBlur = 12;
      for (const [i, j] of EDGES) {
        const a = proj[i]!;
        const b = proj[j]!;
        const depth = (a[2] + b[2]) / 2;
        ctx.strokeStyle = `rgba(45,212,191,${0.25 + 0.35 * ((depth + PHI) / (2 * PHI))})`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Nebula */}
      <div className="absolute inset-0 bg-[#12051f]" />
      <div className="nebula absolute -inset-[20%]" />
      {/* Canvas: stars, code rain, wireframe */}
      <canvas ref={canvasRef} className="absolute inset-0" />
      {/* Floating crystals */}
      {CRYSTALS.map((c, i) => (
        <div key={i} className="crystal absolute" style={{ left: c.left, top: c.top, animationDelay: c.delay, animationDuration: c.dur, filter: `drop-shadow(0 0 14px ${c.hue}66)` }}>
          <Crystal size={c.size} hue={c.hue} />
        </div>
      ))}
      {/* Readability veil + CRT scanlines + vignette */}
      <div className="absolute inset-0 bg-[#080b14]/25" />
      <div className="scanlines absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.65))]" />
    </div>
  );
}
