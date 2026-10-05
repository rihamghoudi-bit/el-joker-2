import type { AgentName } from "@eljoker/shared";

export interface AgentMeta {
  id: AgentName;
  name: string;
  role: string;
  tagline: string;
  glyph: string;
  color: string;
  usesAi: boolean;
}

/** The five EL JOKER characters (+ operator/system). */
export const AGENTS: Record<AgentName, AgentMeta> = {
  LEM3ALEM: { id: "LEM3ALEM", name: "Lem3alem", role: "Coordinator", tagline: "Plans the mission, never guesses facts", glyph: "🎩", color: "#f5b700", usesAi: true },
  LEMHAF: { id: "LEMHAF", name: "Lemhaf", role: "AI research", tagline: "Finds & ranks offers — recommends only", glyph: "🔍", color: "#a78bfa", usesAi: true },
  NASNES: { id: "NASNES", name: "Nasnes", role: "Verifier", tagline: "Checks every claim independently", glyph: "🕵️", color: "#2dd4bf", usesAi: false },
  "3ASES": { id: "3ASES", name: "3ases", role: "Guardian", tagline: "Deterministic policy. No LLM.", glyph: "🛡️", color: "#e70013", usesAi: false },
  KANAWITA: { id: "KANAWITA", name: "Kanawita", role: "Payment", tagline: "Pays only when authorized", glyph: "💰", color: "#22c55e", usesAi: false },
  OPERATOR: { id: "OPERATOR", name: "Operator", role: "Human control", tagline: "Decides high-risk actions", glyph: "🧑‍💼", color: "#2ea3f2", usesAi: false },
  SYSTEM: { id: "SYSTEM", name: "System", role: "Platform", tagline: "", glyph: "⚙️", color: "#7b88a8", usesAi: false },
};

export const PIPELINE: AgentName[] = ["LEM3ALEM", "LEMHAF", "NASNES", "3ASES", "KANAWITA"];
