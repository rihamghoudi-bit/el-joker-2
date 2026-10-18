import type { ItemCategory, MissionDraftInput, RequestedItem, ScenarioId, ScenarioInfo, Supplier } from "@eljoker/shared";

/**
 * DEMO DATA — every supplier below is fictional and labeled "(demo)".
 * Registry entries are a simulated procurement registry, not a real authority.
 */

export type ItemKey =
  | "water_bottle"
  | "medicine_kit"
  | "ors"
  | "hygiene_kit"
  | "food_parcel"
  | "shelter_kit"
  | "electronics"
  | "laptop"
  | "monitor"
  | "office_chair"
  | "office_supplies"
  | "other";

export interface DemoSupplier extends Supplier {
  priceList: Partial<Record<ItemKey, number>>;
  deliveryHours: number;
  /** Express brokers only bid on rush orders (deadline <= 24h). */
  bidsOnlyOnRush: boolean;
  hasLicenseEvidence: boolean;
  invoicePrefix: string;
  /** A supplier that reuses the same invoice number on every quote (fraud pattern for scenario G). */
  fixedInvoiceId?: string;
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
    priceList: { water_bottle: 1.5, medicine_kit: 126, ors: 1.65, hygiene_kit: 28.5 },
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
    priceList: { water_bottle: 1.41, medicine_kit: 138, ors: 1.8, hygiene_kit: 30, food_parcel: 72 },
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
    priceList: { water_bottle: 1.44, medicine_kit: 132, ors: 1.74, hygiene_kit: 27, shelter_kit: 255 },
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
    priceList: { water_bottle: 0.9, medicine_kit: 63, ors: 0.96 },
    deliveryHours: 10,
    bidsOnlyOnRush: true,
    hasLicenseEvidence: false,
    invoicePrefix: "SXT",
  },
  {
    supplierId: "SUP-KAIROUAN",
    name: "Kairouan Quick Supply (demo)",
    region: "Kairouan",
    serviceRegions: ["Kairouan", "Sidi Bouzid"],
    categories: ["WATER", "MEDICINE", "FOOD"],
    verified: true,
    verificationSource: "Simulated procurement registry · entry DPR-0311",
    riskFlags: [],
    claims: ["Same-day dispatch in central Tunisia"],
    isDemo: true,
    priceList: { water_bottle: 1.35, medicine_kit: 129, ors: 1.68, food_parcel: 72 },
    deliveryHours: 24,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "KQS",
    fixedInvoiceId: "INV-KQS-2026-0042",
  },
  /* ---- ACME Tunisia (second use case: company procurement) ---- */
  {
    supplierId: "SUP-CARTHAGE-IT",
    name: "Carthage IT Distribution (demo)",
    region: "Tunis",
    serviceRegions: ["Tunis", "Sousse", "Sfax"],
    categories: ["ELECTRONICS", "OFFICE"],
    verified: true,
    verificationSource: "Simulated vendor registry · entry VND-0418",
    riskFlags: [],
    claims: ["Authorized business laptop reseller", "Next-day delivery in Greater Tunis"],
    isDemo: true,
    priceList: { laptop: 2460, monitor: 495, office_supplies: 12.6 },
    deliveryHours: 48,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "CIT",
  },
  {
    supplierId: "SUP-SOUSSE-OFFICE",
    name: "Sousse Office Pro (demo)",
    region: "Sousse",
    serviceRegions: ["Sousse", "Tunis"],
    categories: ["ELECTRONICS", "OFFICE"],
    verified: true,
    verificationSource: "Simulated vendor registry · entry VND-0377",
    riskFlags: [],
    claims: ["Office furniture and supplies since 2009"],
    isDemo: true,
    priceList: { laptop: 2580, monitor: 477, office_chair: 354, office_supplies: 11.4 },
    deliveryHours: 72,
    bidsOnlyOnRush: false,
    hasLicenseEvidence: true,
    invoicePrefix: "SOP",
  },
];

/** Demo history: invoice INV-KQS-2026-0042 was already used by an earlier (fictional) mission in September. */
export const HISTORICAL_OFFERS = [
  {
    offerId: "off_demo_history_kqs_0042",
    supplierId: "SUP-KAIROUAN",
    missionId: "demo-history-2026-09",
    items: [{ category: "WATER" as const, name: "Bottled drinking water 1.5L", quantity: 2000, unitPrice: 1.35, lineTotal: 2700 }],
    totalPrice: 2700,
    currency: "TND" as const,
    deliveryTimeHours: 24,
    invoiceId: "INV-KQS-2026-0042",
    evidence: [],
    createdAt: "2026-09-14T09:00:00.000Z",
    isDemo: true,
  },
];

/** Demo market reference unit prices (TND) used by the price-anomaly rule. */
export const REFERENCE_PRICES: Record<ItemKey, number> = {
  water_bottle: 1.44,
  medicine_kit: 135,
  ors: 1.74,
  hygiene_kit: 28.5,
  food_parcel: 75,
  shelter_kit: 270,
  electronics: 450,
  laptop: 2550,
  monitor: 510,
  office_chair: 375,
  office_supplies: 12,
  other: 30,
};

const CATEGORY_DEFAULT_KEY: Record<ItemCategory, ItemKey> = {
  WATER: "water_bottle",
  MEDICINE: "medicine_kit",
  FOOD: "food_parcel",
  HYGIENE: "hygiene_kit",
  SHELTER: "shelter_kit",
  ELECTRONICS: "electronics",
  OFFICE: "office_supplies",
  OTHER: "other",
};

export function itemKey(item: Pick<RequestedItem, "category" | "name">): ItemKey {
  const n = item.name.toLowerCase();
  if (/rehydrat|\bors\b/.test(n)) return "ors";
  if (item.category === "MEDICINE" && /kit|medic/.test(n)) return "medicine_kit";
  if (/water/.test(n)) return "water_bottle";
  if (/hygiene/.test(n)) return "hygiene_kit";
  if (/laptop|notebook/.test(n)) return "laptop";
  if (/monitor|screen|display/.test(n)) return "monitor";
  if (/chair/.test(n)) return "office_chair";
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
    organizationId: "NGO_RELIEF",
    request: "500 people in Gabès need drinking water and essential medicine after a water network failure. Budget: 15,000 TND. Delivery within 48 hours to the civil-protection warehouse.",
    letter: "A",
    title: "Approved mission",
    pitch: "500 people in Gabès need water and essential medicine. Budget 15,000 TND.",
    expected: "Verified supplier, valid offer → 3ASES APPROVED → KANAWITA pays on testnet → proofs verifiable.",
    followUp: null,
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès after a water network failure.",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 15000,
      currency: "TND",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: ["Deliver to the regional civil-protection warehouse"],
    }),
  },
  {
    id: "B_BUDGET_BLOCK",
    organizationId: "NGO_RELIEF",
    request: "500 people in Gabès need drinking water and essential medicine. We only have 300 TND available. Delivery within 48 hours.",
    letter: "B",
    title: "Budget block",
    pitch: "Same Gabès mission, but only 300 TND available.",
    expected: "Every offer exceeds the budget → 3ASES BLOCKED → KANAWITA never runs → block proof on Hedera.",
    followUp: null,
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès with a 300 TND budget.",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 300,
      currency: "TND",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "C_DUPLICATE_PAYMENT",
    organizationId: "NGO_RELIEF",
    request: "500 people in Gabès need drinking water and essential medicine. Budget: 15,000 TND. Delivery within 48 hours.",
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
      maximumBudget: 15000,
      currency: "TND",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "D_UNVERIFIED_SUPPLIER",
    organizationId: "NGO_RELIEF",
    request: "Rush: 500 people in Gabès need drinking water and essential medicine within 12 hours. Budget: 15,000 TND.",
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
      maximumBudget: 15000,
      currency: "TND",
      deadline: hoursFromNow(12),
      urgency: "CRITICAL",
      constraints: ["Delivery within 12 hours"],
    }),
  },
  {
    id: "E_HUMAN_REVIEW",
    organizationId: "NGO_RELIEF",
    request: "2,000 displaced people in Médenine need drinking water and essential medicine. Budget: 60,000 TND. Delivery within 72 hours.",
    letter: "E",
    title: "High-risk human review",
    pitch: "2,000 displaced people in Médenine. Budget 60,000 TND — above the autonomous limit.",
    expected: "3ASES → HUMAN_REVIEW_REQUIRED. Payment stays stopped until an operator approves (or rejects).",
    followUp: "Payment is on hold: approve or reject in the approval card at the end of the conversation (demo PIN in the README).",
    draft: () => ({
      description: "Water and essential medicine for 2,000 displaced people in Médenine.",
      location: "Médenine",
      beneficiaries: 2000,
      requestedItems: [
        { category: "WATER", name: "Bottled drinking water 1.5L", quantity: 12000, unit: "bottle" },
        { category: "MEDICINE", name: "Essential medicine kit", quantity: 200, unit: "kit" },
        { category: "MEDICINE", name: "Oral rehydration salts (ORS)", quantity: 4000, unit: "sachet" },
      ],
      maximumBudget: 60000,
      currency: "TND",
      deadline: hoursFromNow(72),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "F_TAMPERING",
    organizationId: "NGO_RELIEF",
    request: "500 people in Gabès need drinking water and essential medicine. Budget: 15,000 TND. Delivery within 48 hours. (audit integrity drill)",
    letter: "F",
    title: "Tampering detection",
    pitch: "Create real evidence and Hedera proofs, then edit the local history.",
    expected: "Verification recomputes hashes → local record ≠ Hedera proof → TAMPERING DETECTED.",
    followUp: "Open “Proof & verify”, then: Verify → Simulate local tampering (or Insider rewrites hashes / Delete last event) → Verify again.",
    draft: () => ({
      description: "Emergency water and essential medicine for 500 people in Gabès (audit integrity drill).",
      location: "Gabès",
      beneficiaries: 500,
      requestedItems: GABES_ITEMS,
      maximumBudget: 15000,
      currency: "TND",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  {
    id: "G_RECYCLED_INVOICE",
    organizationId: "NGO_RELIEF",
    request: "400 people in Kairouan need drinking water and essential medicine after flash floods. Budget: 13,500 TND. Delivery within 48 hours.",
    letter: "G",
    title: "Recycled invoice",
    pitch: "A verified, cheap supplier in Kairouan — but its invoice number was already used.",
    expected: "LEMHAF picks the cheapest offer → NASNES finds the invoice was already used by an earlier mission → REJECTED → 3ASES BLOCKED.",
    followUp: null,
    draft: () => ({
      description: "Water and essential medicine for 400 people in Kairouan after flash floods.",
      location: "Kairouan",
      beneficiaries: 400,
      requestedItems: [
        { category: "WATER", name: "Bottled drinking water 1.5L", quantity: 2400, unit: "bottle" },
        { category: "MEDICINE", name: "Essential medicine kit", quantity: 40, unit: "kit" },
        { category: "MEDICINE", name: "Oral rehydration salts (ORS)", quantity: 800, unit: "sachet" },
      ],
      maximumBudget: 13500,
      currency: "TND",
      deadline: hoursFromNow(48),
      urgency: "HIGH",
      constraints: [],
    }),
  },
  /* ---- ACME Tunisia: the same agents and proofs, a different organization and policy ---- */
  {
    id: "H_ACME_SUPPLIES",
    organizationId: "ACME_PROCUREMENT",
    request: "ACME Tunisia: restock printer paper and stationery for the 120 employees of the Tunis office. 300 packs. Budget: 4,500 TND. Delivery within 5 days.",
    letter: "H",
    title: "ACME · office supplies",
    pitch: "A company restocks its Tunis office. Small amount, inside ACME's 6,000 TND autonomous limit.",
    expected: "Same agents, ACME policy 1.1.0 → verified vendor → 3ASES APPROVED → paid autonomously → proofs on the same Hedera topic.",
    followUp: null,
    draft: () => ({
      organizationId: "ACME_PROCUREMENT",
      description: "Printer paper and stationery restock for ACME Tunisia's Tunis office (120 employees).",
      location: "Tunis",
      beneficiaries: 120,
      requestedItems: [{ category: "OFFICE", name: "Printer paper & stationery pack", quantity: 300, unit: "pack" }],
      maximumBudget: 4500,
      currency: "TND",
      deadline: hoursFromNow(120),
      urgency: "MEDIUM",
      constraints: ["Deliver to the Tunis office reception"],
    }),
  },
  {
    id: "I_ACME_LAPTOPS",
    organizationId: "ACME_PROCUREMENT",
    request: "ACME Tunisia: 12 laptops and 12 monitors for the new engineering team in Tunis. Budget: 45,000 TND. Delivery within 7 days.",
    letter: "I",
    title: "ACME · laptops above the limit",
    pitch: "12 laptops + 12 monitors: far above ACME's 6,000 TND autonomous limit.",
    expected: "3ASES → HUMAN_REVIEW_REQUIRED → the payment is locked in the Hedera vault (2-of-2) until the approver co-signs.",
    followUp: "The payment is locked on Hedera: approve or reject in the approval card (demo PIN in the README).",
    draft: () => ({
      organizationId: "ACME_PROCUREMENT",
      description: "Laptops and monitors for ACME Tunisia's new engineering team (12 employees).",
      location: "Tunis",
      beneficiaries: 12,
      requestedItems: [
        { category: "ELECTRONICS", name: "Business laptop 14-inch", quantity: 12, unit: "unit" },
        { category: "ELECTRONICS", name: "24-inch monitor", quantity: 12, unit: "unit" },
      ],
      maximumBudget: 45000,
      currency: "TND",
      deadline: hoursFromNow(168),
      urgency: "MEDIUM",
      constraints: [],
    }),
  },
];

export function getScenario(id: string): ScenarioDefinition | undefined {
  return SCENARIOS.find((s) => s.id === (id as ScenarioId));
}
