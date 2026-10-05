import type { ItemCategory, MissionDraftInput, RequestedItem, ScenarioId, ScenarioInfo, Supplier } from "@eljoker/shared";

/**
 * DEMO DATA — every supplier below is fictional and labeled "(demo)".
 * Registry entries are a simulated procurement registry, not a real authority.
 */

export type ItemKey = "water_bottle" | "medicine_kit" | "ors" | "hygiene_kit" | "food_parcel" | "shelter_kit" | "electronics" | "other";

export interface DemoSupplier extends Supplier {
  priceList: Partial<Record<ItemKey, number>>;
  deliveryHours: number;
  /** Express brokers only bid on rush orders (deadline <= 24h). */
  bidsOnlyOnRush: boolean;
  hasLicenseEvidence: boolean;
  invoicePrefix: string;
}

export const DEMO_SUPPLIERS: DemoSupplier[] = [
  {
    supplierId: "SUP-OASIS",
    name: "Oasis Medical & Water Supply (demo)",
    region: "Gabès",
    serviceRegions: ["Gabès", "Médenine", "Kébili", "Tataouine", "Sfax"],
    categories: ["WATER", "MEDICINE", "HYGIENE"],
    verified: true,
    verificationSource: "Simulated procurement registry · entry DPR-0142",
    riskFlags: [],
    claims: ["Licensed pharmacy wholesaler", "Cold-chain capable"],
    isDemo: true,
    priceList: { water_bottle: 0.5, medicine_kit: 42, ors: 0.55, hygiene_kit: 9.5 },
    deliveryHours: 20,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "OAS",
  },
  {
    supplierId: "SUP-SFAX",
    name: "Sfax Relief Logistics (demo)",
    region: "Sfax",
    serviceRegions: ["Sfax", "Gabès", "Kairouan", "Sidi Bouzid"],
    categories: ["WATER", "MEDICINE", "FOOD", "HYGIENE"],
    verified: true,
    verificationSource: "Simulated procurement registry · entry DPR-0087",
    riskFlags: [],
    claims: ["Regional humanitarian logistics partner"],
    isDemo: true,
    priceList: { water_bottle: 0.47, medicine_kit: 46, ors: 0.6, hygiene_kit: 10, food_parcel: 24 },
    deliveryHours: 36,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "SRL",
  },
  {
    supplierId: "SUP-MEDENINE",
    name: "Médenine Humanitarian Depot (demo)",
    region: "Médenine",
    serviceRegions: ["Médenine", "Tataouine", "Gabès"],
    categories: ["WATER", "MEDICINE", "HYGIENE", "SHELTER"],
    verified: true,
    verificationSource: "Simulated procurement registry · entry DPR-0203",
    riskFlags: [],
    claims: ["Warehouse in Médenine"],
    isDemo: true,
    priceList: { water_bottle: 0.48, medicine_kit: 44, ors: 0.58, hygiene_kit: 9, shelter_kit: 85 },
    deliveryHours: 30,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "MHD",
  },
  {
    supplierId: "SUP-SAHEL",
    name: "Sahel Express Trading (demo)",
    region: "Gabès",
    serviceRegions: ["Gabès", "Médenine", "Sfax"],
    categories: ["WATER", "MEDICINE"],
    verified: false,
    verificationSource: null,
    riskFlags: ["NOT_IN_REGISTRY", "NO_LICENSE_EVIDENCE", "NEW_COUNTERPARTY"],
    claims: ["Certified pharmaceutical distributor", "Fastest delivery in the south"],
    isDemo: true,
    priceList: { water_bottle: 0.3, medicine_kit: 21, ors: 0.32 },
    deliveryHours: 10,
    bidsOnlyOnRush: true,
    hasLicenseEvidence: false,
    invoicePrefix: "SXT",
  },
];

/** Demo market reference unit prices (USD) used by the price-anomaly rule. */
export const REFERENCE_PRICES: Record<ItemKey, number> = {
  water_bottle: 0.48,
  medicine_kit: 45,
  ors: 0.58,
  hygiene_kit: 9.5,
  food_parcel: 25,
  shelter_kit: 90,
  electronics: 150,
  other: 10,
};

const CATEGORY_DEFAULT_KEY: Record<ItemCategory, ItemKey> = {
  WATER: "water_bottle",
  MEDICINE: "medicine_kit",
  FOOD: "food_parcel",
  HYGIENE: "hygiene_kit",
  SHELTER: "shelter_kit",
  ELECTRONICS: "electronics",
  OTHER: "other",
};

export function itemKey(item: Pick<RequestedItem, "category" | "name">): ItemKey {
  const n = item.name.toLowerCase();
  if (/rehydrat|\bors\b/.test(n)) return "ors";
  if (item.category === "MEDICINE" && /kit|medic/.test(n)) return "medicine_kit";
  if (/water/.test(n)) return "water_bottle";
  if (/hygiene/.test(n)) return "hygiene_kit";
  return CATEGORY_DEFAULT_KEY[item.category];
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

const GABES_ITEMS: RequestedItem[] = [
  { category: "WATER", name: "Bottled drinking water 1.5L", quantity: 3000, unit: "bottle" },
  { category: "MEDICINE", name: "Essential medicine kit", quantity: 50, unit: "kit" },
  { category: "MEDICINE", name: "Oral rehydration salts (ORS)", quantity: 1000, unit: "sachet" },
];

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export interface ScenarioDefinition extends ScenarioInfo {
  draft: () => MissionDraftInput;
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "A_APPROVED",
    request: "500 people in Gabès need drinking water and essential medicine after a water network failure. Budget: $5,000. Delivery within 48 hours to the civil-protection warehouse.",
    letter: "A",
    title: "Approved mission",
    pitch: "500 people in Gabès need water and essential medicine. Budget $5,000.",
    expected: "Verified supplier, valid offer → 3ASES APPROVED → KANAWITA pays on testnet → proofs verifiable.",
    followUp: null,
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès after a water network failure.",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 5000,
      currency: "USD",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: ["Deliver to the regional civil-protection warehouse"],
    }),
  },
  {
    id: "B_BUDGET_BLOCK",
    request: "500 people in Gabès need drinking water and essential medicine. We only have $100 available. Delivery within 48 hours.",
    letter: "B",
    title: "Budget block",
    pitch: "Same Gabès mission, but only $100 available.",
    expected: "Every offer exceeds the budget → 3ASES BLOCKED → KANAWITA never runs → block proof on Hedera.",
    followUp: null,
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès with a $100 budget.",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 100,
      currency: "USD",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "C_DUPLICATE_PAYMENT",
    request: "500 people in Gabès need drinking water and essential medicine. Budget: $5,000. Delivery within 48 hours.",
    letter: "C",
    title: "Duplicate payment attack",
    pitch: "Pay once, then replay exactly the same payment.",
    expected: "First payment confirmed. Replay → KANAWITA rejects (mission paid + idempotency key used) → PAYMENT_BLOCKED proof.",
    followUp: "After PAID, press “Replay payment (attack)”.",
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès (duplicate-payment drill).",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 5000,
      currency: "USD",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "D_UNVERIFIED_SUPPLIER",
    request: "Rush: 500 people in Gabès need drinking water and essential medicine within 12 hours. Budget: $5,000.",
    letter: "D",
    title: "Unverified supplier",
    pitch: "Rush order: delivery within 12 hours. Only a cheap, unknown broker can make it.",
    expected: "LEMHAF recommends the attractive offer → NASNES rejects (not in registry, no license) → 3ASES BLOCKED → no payment.",
    followUp: null,
    draft: () => ({
      description: "Rush: 500 people in Gabès need water and essential medicine within 12 hours.",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 5000,
      currency: "USD",
      deadline: hoursFromNow(12),
      urgency: "CRITICAL",
      constraints: ["Delivery within 12 hours"],
    }),
  },
  {
    id: "E_HUMAN_REVIEW",
    request: "2,000 displaced people in Médenine need drinking water and essential medicine. Budget: $20,000. Delivery within 72 hours.",
    letter: "E",
    title: "High-risk human review",
    pitch: "2,000 displaced people in Médenine. Budget $20,000 — above the autonomous limit.",
    expected: "3ASES → HUMAN_REVIEW_REQUIRED. Payment stays stopped until an operator approves (or rejects).",
    followUp: "Approve or reject in the Human Approval card.",
    draft: () => ({
      description: "Water and essential medicine for 2,000 displaced people in Médenine.",
      location: "Médenine",
      beneficiaries: 2000,
      requestedItems: [
        { category: "WATER", name: "Bottled drinking water 1.5L", quantity: 12000, unit: "bottle" },
        { category: "MEDICINE", name: "Essential medicine kit", quantity: 200, unit: "kit" },
        { category: "MEDICINE", name: "Oral rehydration salts (ORS)", quantity: 4000, unit: "sachet" },
      ],
      maximumBudget: 20000,
      currency: "USD",
      deadline: hoursFromNow(72),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "F_TAMPERING",
    request: "500 people in Gabès need drinking water and essential medicine. Budget: $5,000. Delivery within 48 hours. (audit integrity drill)",
    letter: "F",
    title: "Tampering detection",
    pitch: "Create real evidence and Hedera proofs, then edit the local history.",
    expected: "Verification recomputes hashes → local record ≠ Hedera proof → TAMPERING DETECTED.",
    followUp: "Open “Proof & Verify”, press “Simulate local tampering”, then “Verify against Hedera”.",
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès (audit integrity drill).",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 5000,
      currency: "USD",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
];

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === (id as ScenarioId));
}
