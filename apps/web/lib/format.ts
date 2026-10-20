export { money } from "@eljoker/shared";

export const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const shortHash = (h: string | null | undefined, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
