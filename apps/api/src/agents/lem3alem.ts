/**
 * LEM3ALEM — mission coordinator / planner.
 * Converts a request (structured and/or free text) into a validated Mission draft.
 * Never invents critical facts: missing location / beneficiaries / budget / items => NEEDS_INFORMATION.
 */
import { type CreateMissionRequest, ItemCategory, type ExecutionMode, MissionDraft, type MissionDraftInput, type RequestedItem, Urgency } from "@eljoker/shared";
import { z } from "zod";
import { type AiClient, AiUnavailableError } from "../ai/aiClient";
import { normalizeRegion } from "./guardian/policy";

const CRITICAL_FIELDS = ["description", "location", "beneficiaries", "maximumBudget", "requestedItems"] as const;

export interface PlanResult {
  status: "CREATED" | "NEEDS_INFORMATION";
  draft: MissionDraft | null;
  partial: Partial<MissionDraftInput>;
  missingFields: string[];
  mode: ExecutionMode;
  model: string | null;
  fallbackReason: string | null;
  latencyMs: number | null;
  notes: string[];
}

/* ---------------- AI extraction contract ---------------- */
// Kept free of numeric constraints (structured-output friendly); validated again by MissionDraft afterwards.
export const AiMissionExtraction = z.object({
  description: z.string(),
  location: z.string().nullable(),
  beneficiaries: z.number().nullable(),
  maximumBudgetUsd: z.number().nullable(),
  /** Currency the budget was written in. TND is converted with the configured demo rate. */
  budgetCurrency: z.enum(["USD", "TND"]).nullable(),
  urgency: Urgency.nullable(),
  deadlineHours: z.number().nullable(),
  items: z.array(z.object({ category: ItemCategory, name: z.string(), quantity: z.number().nullable(), unit: z.string() })),
});
export type AiMissionExtraction = z.infer<typeof AiMissionExtraction>;

const EXTRACTION_SYSTEM = `You are LEM3ALEM, the mission planner of EL JOKER, an emergency procurement system.
Extract a procurement mission from the operator's request.
Rules:
- Only report facts that are explicitly stated. If location, number of people, budget, deadline or urgency is not stated, return null for it. Never guess them.
- maximumBudgetUsd is the budget amount as written; set budgetCurrency to "TND" if it is in Tunisian dinars (TND, DT, dinars), "USD" if in dollars.
- items: list the supplies requested. Use category WATER, MEDICINE, FOOD, HYGIENE, SHELTER, ELECTRONICS or OTHER. Set quantity only if the request states it, otherwise null.
- description: one neutral sentence summarizing the need, without personal data.
- You do not approve or authorize anything; you only structure the request.`;

/* ---------------- deterministic fallback extraction ---------------- */
const KNOWN_REGIONS = ["Gabès", "Médenine", "Sfax", "Kébili", "Tataouine", "Gafsa", "Tozeur", "Kairouan", "Sidi Bouzid", "Kasserine", "Tunis", "Djerba", "Sousse", "Bizerte", "Tripoli"];

export function ruleBasedExtraction(text: string): AiMissionExtraction {
  const norm = normalizeRegion(text);
  const location = KNOWN_REGIONS.find((r) => norm.includes(normalizeRegion(r))) ?? null;
  const usdMoney = text.match(/\$\s?([\d][\d,.]*)\s*(k)?/i) ?? text.match(/([\d][\d,.]*)\s*(k)?\s*(?:usd|dollars?)\b/i);
  const tndMoney = usdMoney ? null : text.match(/([\d][\d,.]*)\s*(k)?\s*(?:tnd|dt|dinars?)\b/i);
  const money = usdMoney ?? tndMoney;
  let maximumBudgetUsd: number | null = null;
  if (money?.[1]) {
    maximumBudgetUsd = Number(money[1].replace(/,/g, ""));
    if (money[2]) maximumBudgetUsd *= 1000;
  }
  const budgetCurrency: "USD" | "TND" | null = money ? (tndMoney ? "TND" : "USD") : null;
  const people = text.match(/([\d][\d,]*)\s*(?:people|persons|residents|beneficiaries|displaced|individuals)/i);
  const hours = text.match(/within\s+(\d+)\s*(hours?|h|days?)/i);
  const deadlineHours = hours?.[1] ? Number(hours[1]) * (/day/i.test(hours[2] ?? "") ? 24 : 1) : null;
  const items: AiMissionExtraction["items"] = [];
  if (/water/i.test(text)) items.push({ category: "WATER", name: "Bottled drinking water 1.5L", quantity: null, unit: "bottle" });
  if (/medic|medicine|pharma/i.test(text)) items.push({ category: "MEDICINE", name: "Essential medicine kit", quantity: null, unit: "kit" });
  if (/rehydrat|\bors\b/i.test(text)) items.push({ category: "MEDICINE", name: "Oral rehydration salts (ORS)", quantity: null, unit: "sachet" });
  if (/hygiene|soap/i.test(text)) items.push({ category: "HYGIENE", name: "Hygiene kit", quantity: null, unit: "kit" });
  if (/food|meal/i.test(text)) items.push({ category: "FOOD", name: "Food parcel", quantity: null, unit: "parcel" });
  if (/tent|shelter/i.test(text)) items.push({ category: "SHELTER", name: "Shelter kit", quantity: null, unit: "kit" });
  if (/laptop|phone|electronic/i.test(text)) items.push({ category: "ELECTRONICS", name: "Electronics", quantity: null, unit: "unit" });
  const urgency = /critical|immediately|urgent|rush|asap/i.test(text) ? (/critical|rush/i.test(text) ? "CRITICAL" : "HIGH") : null;
  return {
    description: text.trim().slice(0, 300),
    location,
    beneficiaries: people?.[1] ? Number(people[1].replace(/,/g, "")) : null,
    maximumBudgetUsd,
    budgetCurrency,
    urgency,
    deadlineHours,
    items,
  };
}

/** Documented planning ratios used ONLY when the request names an item but not its quantity (flagged as an assumption). */
const PER_PERSON: Record<string, (n: number) => number> = {
  water: (n) => n * 6,
  medicine_kit: (n) => Math.ceil(n / 10),
  ors: (n) => n * 2,
  HYGIENE: (n) => Math.ceil(n / 4),
  FOOD: (n) => Math.ceil(n / 5),
  SHELTER: (n) => Math.ceil(n / 5),
};

function estimateQuantity(item: AiMissionExtraction["items"][number], beneficiaries: number): number {
  const n = item.name.toLowerCase();
  if (item.category === "WATER") return PER_PERSON.water!(beneficiaries);
  if (/rehydrat|\bors\b/.test(n)) return PER_PERSON.ors!(beneficiaries);
  if (item.category === "MEDICINE") return PER_PERSON.medicine_kit!(beneficiaries);
  return (PER_PERSON[item.category] ?? ((x: number) => Math.ceil(x / 10)))(beneficiaries);
}

function defaultDeadlineHours(urgency: Urgency): number {
  return urgency === "CRITICAL" ? 24 : urgency === "HIGH" ? 72 : 168;
}

export async function planMission(req: CreateMissionRequest, ai: AiClient, opts: { tndPerUsd: number } = { tndPerUsd: 3.1 }): Promise<PlanResult> {
  const notes: string[] = [];
  const partial: Partial<MissionDraftInput> = { ...(req.mission ?? {}) };
  let mode: ExecutionMode = "DETERMINISTIC";
  let model: string | null = null;
  let fallbackReason: string | null = null;
  let latencyMs: number | null = null;

  const structuredComplete = CRITICAL_FIELDS.every((f) => partial[f] !== undefined && !(Array.isArray(partial[f]) && (partial[f] as unknown[]).length === 0));

  if (req.text && !structuredComplete) {
    let extraction: AiMissionExtraction;
    if (ai.available) {
      try {
        const res = await ai.generateStructured({ system: EXTRACTION_SYSTEM, user: `Operator request:\n"""${req.text}"""`, schema: AiMissionExtraction, maxTokens: 2000 });
        extraction = res.data;
        mode = "REAL_AI";
        model = res.model;
        latencyMs = res.latencyMs;
      } catch (e) {
        fallbackReason = e instanceof AiUnavailableError ? e.message : "AI extraction failed";
        extraction = ruleBasedExtraction(req.text);
        mode = "FALLBACK";
      }
    } else {
      fallbackReason = ai.unavailableReason;
      extraction = ruleBasedExtraction(req.text);
      mode = "FALLBACK";
    }
    partial.description ??= extraction.description;
    if (extraction.location) partial.location ??= extraction.location;
    if (extraction.beneficiaries) partial.beneficiaries ??= Math.round(extraction.beneficiaries);
    if (extraction.maximumBudgetUsd && partial.maximumBudget === undefined) {
      if (extraction.budgetCurrency === "TND") {
        partial.maximumBudget = Math.round((extraction.maximumBudgetUsd / opts.tndPerUsd) * 100) / 100;
        notes.push(`Budget converted from ${extraction.maximumBudgetUsd.toLocaleString("en-US")} TND at ${opts.tndPerUsd} TND/USD (configurable demo rate)`);
      } else {
        partial.maximumBudget = extraction.maximumBudgetUsd;
      }
    }
    if (extraction.urgency) partial.urgency ??= extraction.urgency;
    if (extraction.deadlineHours && !partial.deadline) partial.deadline = new Date(Date.now() + extraction.deadlineHours * 3_600_000).toISOString();
    if (!partial.requestedItems?.length && extraction.items.length) {
      if (partial.beneficiaries) {
        const estimated = extraction.items.some((i) => !i.quantity);
        partial.requestedItems = extraction.items.map<RequestedItem>((i) => ({ category: i.category, name: i.name, unit: i.unit || "unit", quantity: i.quantity && i.quantity > 0 ? Math.round(i.quantity) : estimateQuantity(i, partial.beneficiaries!) }));
        if (estimated) notes.push("Quantities estimated from standard planning ratios (assumption, editable)");
      } else {
        // Without the number of people we cannot size the order: leave items missing.
        notes.push("Items identified but quantities need the number of beneficiaries");
      }
    }
  }

  const missingFields = CRITICAL_FIELDS.filter((f) => partial[f] === undefined || partial[f] === null || (Array.isArray(partial[f]) && (partial[f] as unknown[]).length === 0));
  if (missingFields.length > 0) {
    return { status: "NEEDS_INFORMATION", draft: null, partial, missingFields: [...missingFields], mode, model, fallbackReason, latencyMs, notes };
  }

  const urgency = (partial.urgency ?? "HIGH") as Urgency;
  if (!partial.deadline) {
    partial.deadline = new Date(Date.now() + defaultDeadlineHours(urgency) * 3_600_000).toISOString();
    notes.push(`Deadline not specified — planning horizon of ${defaultDeadlineHours(urgency)}h assumed from urgency ${urgency}`);
  }
  if (notes.length) partial.constraints = [...(partial.constraints ?? []), ...notes].slice(0, 10);

  const parsed = MissionDraft.safeParse(partial);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "mission")))];
    return { status: "NEEDS_INFORMATION", draft: null, partial, missingFields: fields, mode, model, fallbackReason, latencyMs, notes: [...notes, ...parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)] };
  }
  return { status: "CREATED", draft: parsed.data, partial, missingFields: [], mode, model, fallbackReason, latencyMs, notes };
}
