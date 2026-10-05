/**
 * LEM3ALEM's pipeline: plan -> LEMHAF -> NASNES -> 3ASES -> (human) -> KANAWITA.
 * Every important step is persisted, written to the hash-linked audit chain, and anchored to Hedera.
 */
import {
  type AgentName,
  type AgentRun,
  type ApprovalRequest,
  type CreateMissionRequest,
  type ExecutionMode,
  type GuardianDecision,
  type Mission,
  type MissionState,
  type Supplier,
  type TrailVerification,
} from "@eljoker/shared";
import type { AiClient } from "../ai/aiClient";
import type { AppConfig } from "../config";
import type { ProofService, TamperMode } from "../audit/proofService";
import type { Store } from "../db/store";
import type { LedgerGateway } from "../hedera/gateway";
import { createHash, timingSafeEqual } from "node:crypto";
import { hashCanonical, newId, nowIso, sleep } from "../lib/canonical";
import { logger } from "../logger";
import { DEMO_SUPPLIERS, getScenario, HISTORICAL_OFFERS } from "../seed/demoData";
import { approvalEvidence, buildGuardianSnapshot, postFeed } from "../agents/context";
import { evaluate } from "../agents/guardian/engine";
import type { LoadedPolicy } from "../agents/guardian/policy";
import { Kanawita } from "../agents/kanawita";
import { planMission } from "../agents/lem3alem";
import { runLemhaf } from "../agents/lemhaf";
import { quoteOffers } from "../agents/marketplace";
import { verifyRecommendation } from "../agents/nasnes";

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}

export interface MissionServiceDeps {
  config: AppConfig;
  store: Store;
  ai: AiClient;
  ledger: LedgerGateway;
  proofs: ProofService;
  policy: LoadedPolicy;
  stepDelayMs?: number;
}

const modeChip = (mode: ExecutionMode, model: string | null) => (mode === "REAL_AI" ? `REAL AI · ${model}` : mode === "FALLBACK" ? "FALLBACK · rule-based" : mode === "DEMO_DATA" ? "DEMO DATA" : "DETERMINISTIC");

export class MissionService {
  readonly kanawita: Kanawita;
  private running = new Map<string, Promise<void>>();
  /** Failed PIN attempts per mission (simple lockout against guessing). */
  private pinFailures = new Map<string, { count: number; until: number }>();
  private currentAgent = new Map<string, AgentName | null>();

  constructor(private readonly deps: MissionServiceDeps) {
    this.kanawita = new Kanawita({ store: deps.store, proofs: deps.proofs, ledger: deps.ledger, policy: deps.policy, config: deps.config });
  }

  seedSuppliers() {
    for (const s of DEMO_SUPPLIERS) this.deps.store.upsertSupplier(s);
    for (const o of HISTORICAL_OFFERS) this.deps.store.upsertHistoricalOffer(o);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  async createMission(req: CreateMissionRequest, scenarioId: string | null = null, requestText: string | null = null): Promise<{ missionId: string; status: Mission["status"]; missingFields: string[] }> {
    const { store, ai } = this.deps;
    const plan = await planMission(req, ai, { tndPerUsd: this.deps.config.tndPerUsd });
    const missionId = newId("msn");
    const draft = plan.draft;
    const mission: Mission = {
      missionId,
      description: draft?.description ?? plan.partial.description ?? req.text ?? "Incomplete request",
      location: draft?.location ?? plan.partial.location ?? "—",
      beneficiaries: draft?.beneficiaries ?? plan.partial.beneficiaries ?? 0,
      requestedItems: draft?.requestedItems ?? plan.partial.requestedItems ?? [],
      maximumBudget: draft?.maximumBudget ?? plan.partial.maximumBudget ?? 0,
      currency: "USD",
      deadline: draft?.deadline ?? plan.partial.deadline ?? nowIso(),
      urgency: draft?.urgency ?? plan.partial.urgency ?? "HIGH",
      constraints: draft?.constraints ?? plan.partial.constraints ?? [],
      createdAt: nowIso(),
      status: plan.status === "CREATED" ? "CREATED" : "NEEDS_INFORMATION",
      scenarioId,
      isDemo: scenarioId !== null,
    };
    store.insertMission(mission, plan.missingFields);
    // The operator's request opens the conversation, exactly as it was sent.
    const sentText = requestText ?? req.text ?? `${mission.description} Budget $${mission.maximumBudget.toLocaleString("en-US")} for ${mission.beneficiaries.toLocaleString("en-US")} people in ${mission.location}.`;
    postFeed(store, missionId, "OPERATOR", "status", sentText, ["REQUEST SENT"], { request: true });
    this.recordRun({ missionId, agent: "LEM3ALEM", mode: plan.mode, status: plan.status === "CREATED" ? "DONE" : "BLOCKED", input: req, summary: plan.status === "CREATED" ? `Mission created: ${mission.beneficiaries} people, ${mission.location}, $${mission.maximumBudget}` : `Needs information: ${plan.missingFields.join(", ")}`, model: plan.model, fallbackReason: plan.fallbackReason, latencyMs: plan.latencyMs });

    if (plan.status === "NEEDS_INFORMATION") {
      postFeed(store, missionId, "LEM3ALEM", "alert", `Some information is missing, and I won't guess critical facts. Missing: ${plan.missingFields.join(", ")}.`, ["NEEDS INFORMATION", modeChip(plan.mode, plan.model)], { missingFields: plan.missingFields, notes: plan.notes });
      return { missionId, status: mission.status, missingFields: plan.missingFields };
    }

    this.deps.proofs.recordEvent({
      missionId,
      eventType: "MISSION_CREATED",
      agent: "LEM3ALEM",
      summary: `Mission created: ${mission.beneficiaries} people in ${mission.location}, budget $${mission.maximumBudget.toLocaleString("en-US")}`,
      payload: {
        missionId,
        description: mission.description,
        location: mission.location,
        beneficiaries: mission.beneficiaries,
        requestedItems: mission.requestedItems,
        maximumBudget: mission.maximumBudget,
        currency: mission.currency,
        deadline: mission.deadline,
        urgency: mission.urgency,
        constraints: mission.constraints,
        scenarioId,
        planner: { mode: plan.mode, model: plan.model },
      },
    });
    postFeed(store, missionId, "LEM3ALEM", "status", `Team, we have a new mission: ${mission.description} Budget $${mission.maximumBudget.toLocaleString("en-US")}, ${mission.beneficiaries.toLocaleString("en-US")} people, ${mission.location}.`, ["MISSION CREATED", modeChip(plan.mode, plan.model)], { notes: plan.notes });

    this.startPipeline(missionId);
    return { missionId, status: mission.status, missingFields: [] };
  }

  async runScenario(id: string): Promise<{ missionId: string }> {
    const sc = getScenario(id);
    if (!sc) throw new DomainError("UNKNOWN_SCENARIO", `Unknown scenario ${id}`, 404);
    const res = await this.createMission({ mission: sc.draft() }, sc.id, sc.request);
    return { missionId: res.missionId };
  }

  async submitApproval(missionId: string, req: ApprovalRequest): Promise<{ decision: GuardianDecision["decision"] }> {
    const { store, config, policy, proofs } = this.deps;
    const mission = this.mustGet(missionId);
    if (mission.status !== "HUMAN_REVIEW") throw new DomainError("NOT_IN_REVIEW", `Mission is ${mission.status}, not awaiting human review`, 409);
    if (!config.operators.includes(req.actorId)) throw new DomainError("UNAUTHORIZED_OPERATOR", `"${req.actorId}" is not an authorized operator`, 403);
    this.checkPin(missionId, req.pin);
    const last = store.latestGuardianDecision(missionId);
    if (!last || last.decision !== "HUMAN_REVIEW_REQUIRED") throw new DomainError("NO_REVIEW_DECISION", "No pending Guardian review decision", 409);
    // The approval binds to the exact facts the operator reviewed.
    const fresh = buildGuardianSnapshot(store, missionId, this.deps.ledger.payeeAccountId);
    const freshHash = evaluate(fresh.input, policy).inputHash;
    if (freshHash !== last.inputHash) throw new DomainError("STALE_REVIEW", "Mission facts changed since the review was requested", 409);

    const approval = { approvalId: newId("apr"), missionId, actorId: req.actorId, decision: req.decision, reason: req.reason, timestamp: nowIso(), policyVersion: policy.effectiveVersion, guardianInputHash: last.inputHash };
    store.insertApproval(approval);
    proofs.recordEvent({
      missionId,
      eventType: req.decision === "APPROVED" ? "HUMAN_APPROVED" : "HUMAN_REJECTED",
      agent: "OPERATOR",
      summary: `${req.actorId} ${req.decision === "APPROVED" ? "approved" : "rejected"}: ${req.reason}`,
      payload: { ...approval, operatorMode: "DEMO_OPERATOR (no production authentication)" },
    });
    postFeed(store, missionId, "OPERATOR", req.decision === "APPROVED" ? "success" : "alert", `${req.actorId}: ${req.decision === "APPROVED" ? "APPROVED" : "REJECTED"} — “${req.reason}”`, [req.decision === "APPROVED" ? "HUMAN APPROVED" : "HUMAN REJECTED", "DEMO OPERATOR"]);

    const run = (async () => {
      const decision = await this.runGuardian(missionId);
      if (decision.decision === "APPROVED") {
        store.setMissionStatus(missionId, "APPROVED");
        await this.runKanawita(missionId, "AFTER_HUMAN_APPROVAL");
      } else {
        store.setMissionStatus(missionId, req.decision === "REJECTED" ? "REJECTED" : "BLOCKED");
      }
      this.currentAgent.set(missionId, null);
    })().catch((e) => this.fail(missionId, e));
    this.track(missionId, run);
    const latest = store.latestGuardianDecision(missionId);
    return { decision: latest?.decision ?? "HUMAN_REVIEW_REQUIRED" };
  }

  /** Scenario C: replay the exact same payment. KANAWITA must refuse. */
  async replayPayment(missionId: string) {
    this.mustGet(missionId);
    await this.idle(missionId);
    this.currentAgent.set(missionId, "KANAWITA");
    try {
      return await this.kanawita.execute(missionId, "REPLAY");
    } finally {
      this.currentAgent.set(missionId, null);
    }
  }

  async verifyMission(missionId: string): Promise<TrailVerification> {
    this.mustGet(missionId);
    const { store, proofs } = this.deps;
    const report = await proofs.verifyMissionTrail(missionId);
    if (report.overall === "TAMPERING_DETECTED") {
      const tamperedIds = [...report.events.filter((e) => e.status === "TAMPERED").map((e) => e.eventId), ...report.missingLocalEvents.map((m) => m.eventId)].sort();
      const already = store.listAuditEvents(missionId).some((e) => e.eventType === "TAMPER_DETECTED" && hashCanonical(e.payload.tamperedEventIds) === hashCanonical(tamperedIds));
      if (!already) {
        proofs.recordEvent({ missionId, eventType: "TAMPER_DETECTED", agent: "NASNES", summary: `Tampering detected in ${tamperedIds.length} event(s)`, payload: { tamperedEventIds: tamperedIds, tamperedEventTypes: report.events.filter((e) => e.status === "TAMPERED").map((e) => e.eventType), deletedEventTypes: report.missingLocalEvents.map((m) => m.eventType), verifiedAt: report.verifiedAt, ledgerMode: report.ledgerMode } });
      }
      postFeed(store, missionId, "NASNES", "alert", `Someone changed the history! ${report.summary}. The local record no longer matches the Hedera proof.`, ["TAMPERING DETECTED"]);
    } else if (report.overall === "VALID") {
      postFeed(store, missionId, "NASNES", "proof", report.ledgerMode === "LIVE_TESTNET" ? `Proof verified: ${report.summary}.` : `Local chain verified against the SIMULATED ledger (no Hedera credentials): ${report.summary}.`, [report.ledgerMode === "LIVE_TESTNET" ? "PROOF VERIFIED" : "PROOF VERIFIED · SIMULATED"]);
    }
    return report;
  }

  tamper(missionId: string, mode: TamperMode) {
    if (!this.deps.config.demoMode) throw new DomainError("DEMO_ONLY", "Tampering simulation is only available in demo/development mode", 403);
    this.mustGet(missionId);
    const res = this.deps.proofs.tamper(missionId, mode);
    postFeed(this.deps.store, missionId, "SYSTEM", "alert", `⚠ DEMO: local history edited — ${res.eventType}.${res.field}: ${JSON.stringify(res.before)} → ${JSON.stringify(res.after)}${mode === "REWRITE_HASHES" ? " (and the local hash chain was recomputed to hide it)" : mode === "DELETE_LAST_EVENT" ? " (the event was erased from the local database)" : ""}.`, ["SIMULATED TAMPERING"]);
    return res;
  }

  async idle(missionId: string) {
    await (this.running.get(missionId) ?? Promise.resolve());
    await this.deps.proofs.idle(missionId);
  }

  getState(missionId: string, opts: { includePayloads?: boolean } = {}): MissionState {
    const { store } = this.deps;
    const mission = this.mustGet(missionId);
    const offers = store.listOffers(missionId);
    const supplierIds = new Set(offers.map((o) => o.supplierId));
    const suppliers = [...supplierIds].map((id) => store.getSupplier(id)).filter((s): s is Supplier => !!s).map(publicSupplier);
    return {
      mission,
      missingFields: store.getMissingFields(missionId),
      offers,
      suppliers,
      recommendation: store.getRecommendation(missionId),
      agentRuns: store.listAgentRuns(missionId),
      verification: store.latestVerification(missionId),
      guardianDecision: store.latestGuardianDecision(missionId),
      approvals: store.getApproval(missionId) ? [store.getApproval(missionId)!] : [],
      payments: store.listPayments(missionId),
      // Off-chain evidence payloads are only sent when asked (audit view): keeps polling responses small.
      auditEvents: opts.includePayloads ? store.listAuditEvents(missionId) : store.listAuditEvents(missionId).map((e) => ({ ...e, payload: {} })),
      feed: store.listFeed(missionId),
      currentAgent: this.currentAgent.get(missionId) ?? null,
      busy: this.running.has(missionId),
      lastVerification: store.getTrailVerification(missionId),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Pipeline                                                            */
  /* ------------------------------------------------------------------ */

  private startPipeline(missionId: string) {
    const run = this.pipeline(missionId).catch((e) => this.fail(missionId, e));
    this.track(missionId, run);
  }

  private track(missionId: string, p: Promise<void>) {
    const chained = (this.running.get(missionId) ?? Promise.resolve()).then(() => p);
    this.running.set(missionId, chained);
    void chained.finally(() => {
      if (this.running.get(missionId) === chained) this.running.delete(missionId);
    });
  }

  private pause() {
    return sleep(this.deps.stepDelayMs ?? this.deps.config.demoStepDelayMs);
  }

  private async pipeline(missionId: string) {
    const { store } = this.deps;
    /* ---------- LEMHAF ---------- */
    store.setMissionStatus(missionId, "RESEARCHING");
    this.currentAgent.set(missionId, "LEMHAF");
    const mission = this.mustGet(missionId);
    postFeed(store, missionId, "LEMHAF", "working", this.deps.ai.available ? `Searching… asking Claude to rank supplier offers for ${mission.location}.` : "Searching… ranking offers with the rule-based fallback (Claude not configured).", ["AI ANALYZING"]);
    await this.pause();
    const offers = quoteOffers(mission);
    for (const o of offers) store.insertOffer(o);
    if (offers.length === 0) {
      store.setMissionStatus(missionId, "BLOCKED");
      postFeed(store, missionId, "LEMHAF", "alert", `No supplier in the demo marketplace serves ${mission.location} for these items.`, ["NO OFFERS"]);
      this.recordRun({ missionId, agent: "LEMHAF", mode: "DEMO_DATA", status: "BLOCKED", input: { missionId }, summary: "No candidate offers" });
      this.currentAgent.set(missionId, null);
      return;
    }
    const supplierMap = new Map(offers.map((o) => [o.supplierId, publicSupplier(store.getSupplier(o.supplierId)!)]));
    const lem = await runLemhaf(mission, offers, supplierMap, this.deps.ai);
    store.saveRecommendation(missionId, lem.recommendation);
    const top = offers.find((o) => o.offerId === lem.recommendation.recommendedOfferId)!;
    const topSupplier = supplierMap.get(top.supplierId)!;
    this.recordRun({ missionId, agent: "LEMHAF", mode: lem.mode, status: "DONE", input: { mission, offers }, summary: lem.recommendation.summary, model: lem.model, fallbackReason: lem.fallbackReason, latencyMs: lem.latencyMs });
    this.deps.proofs.recordEvent({
      missionId,
      eventType: "AI_RECOMMENDATION",
      agent: "LEMHAF",
      summary: `Recommends ${topSupplier.name} at $${top.totalPrice.toLocaleString("en-US")} (${lem.mode})`,
      payload: {
        mode: lem.mode,
        provider: lem.mode === "REAL_AI" ? "anthropic" : null,
        model: lem.model,
        fallbackReason: lem.fallbackReason,
        inputHash: hashCanonical({ mission, offers }),
        recommendedOfferId: top.offerId,
        offer: { offerId: top.offerId, supplierId: top.supplierId, supplierName: topSupplier.name, totalPrice: top.totalPrice, invoiceId: top.invoiceId },
        candidates: offers.map((o) => ({ offerId: o.offerId, supplierId: o.supplierId, totalPrice: o.totalPrice })),
        summary: lem.recommendation.summary,
        statedFacts: lem.recommendation.statedFacts,
        dataSource: "DEMO_DATA marketplace (fictional suppliers)",
      },
    });
    postFeed(store, missionId, "LEMHAF", "result", `I found ${offers.length} offers. My pick: ${topSupplier.name} — $${top.totalPrice.toLocaleString("en-US")}, ${top.deliveryTimeHours}h delivery. ${lem.recommendation.summary}`, ["RECOMMENDATION", modeChip(lem.mode, lem.model), "DEMO DATA"], {
      recommendation: lem.recommendation,
      fallbackReason: lem.fallbackReason,
    });
    await this.pause();

    /* ---------- NASNES ---------- */
    store.setMissionStatus(missionId, "VERIFYING");
    this.currentAgent.set(missionId, "NASNES");
    postFeed(store, missionId, "NASNES", "working", `Checking ${topSupplier.name} against the registry, the evidence and LEMHAF's claims.`, ["VERIFYING"]);
    await this.pause();
    const supplierRecord = store.getSupplier(top.supplierId);
    const verification = verifyRecommendation({
      mission,
      offer: top,
      supplier: supplierRecord,
      recommendation: lem.recommendation,
      invoiceReusedElsewhere: top.invoiceId ? store.findOffersByInvoice(top.invoiceId, missionId).length > 0 : false,
      invoiceAlreadyPaid: top.invoiceId ? (store.findLivePaymentByInvoice(top.invoiceId)?.missionId ?? missionId) !== missionId : false,
      suspiciousBelowPct: this.deps.policy.priceAnomaly.reviewBelowPct,
    });
    store.insertVerification(verification);
    this.recordRun({ missionId, agent: "NASNES", mode: "DETERMINISTIC", status: verification.status === "VERIFIED" ? "DONE" : "BLOCKED", input: { offer: top, recommendation: lem.recommendation }, summary: `${verification.status}: ${verification.checks.filter((c) => c.passed).length}/${verification.checks.length} checks passed` });
    this.deps.proofs.recordEvent({
      missionId,
      eventType: verification.status === "VERIFIED" ? "SUPPLIER_VERIFIED" : "SUPPLIER_REJECTED",
      agent: "NASNES",
      summary: `${verification.status}: ${topSupplier.name}`,
      payload: { verificationId: verification.verificationId, status: verification.status, offerId: top.offerId, supplierId: top.supplierId, checks: verification.checks, evidenceHashes: top.evidence.map((d) => ({ type: d.type, sha256: d.sha256 })) },
    });
    postFeed(
      store,
      missionId,
      "NASNES",
      verification.status === "VERIFIED" ? "success" : "alert",
      verification.status === "VERIFIED" ? `All good. ${topSupplier.name} checks out: registry, region, items, arithmetic and evidence all verified.` : `Stop! ${verification.status}: ${verification.reasons.slice(0, 3).join(" · ")}`,
      [verification.status === "VERIFIED" ? "VERIFIED" : verification.status === "REJECTED" ? "REJECTED" : "NEEDS REVIEW", "DETERMINISTIC"],
      { verification },
    );
    await this.pause();

    /* ---------- 3ASES ---------- */
    store.setMissionStatus(missionId, "EVALUATING");
    const decision = await this.runGuardian(missionId);
    if (decision.decision === "BLOCKED") {
      store.setMissionStatus(missionId, "BLOCKED");
      postFeed(store, missionId, "KANAWITA", "status", "I won't move a single cent. The Guardian said no, so no payment.", ["NO PAYMENT"]);
      this.currentAgent.set(missionId, null);
      return;
    }
    if (decision.decision === "HUMAN_REVIEW_REQUIRED") {
      store.setMissionStatus(missionId, "HUMAN_REVIEW");
      postFeed(store, missionId, "KANAWITA", "status", "Payment stays stopped until an authorized operator decides.", ["PAYMENT ON HOLD"]);
      this.currentAgent.set(missionId, null);
      return;
    }
    store.setMissionStatus(missionId, "APPROVED");
    await this.pause();
    await this.runKanawita(missionId, "AUTO");
    this.currentAgent.set(missionId, null);
  }

  private async runGuardian(missionId: string): Promise<GuardianDecision> {
    const { store, policy, config, proofs } = this.deps;
    this.currentAgent.set(missionId, "3ASES");
    postFeed(store, missionId, "3ASES", "working", "Rules are rules. Applying policy " + policy.effectiveVersion + " — deterministic rules, no AI.", ["EVALUATING"]);
    await this.pause();
    const snap = buildGuardianSnapshot(store, missionId, this.deps.ledger.payeeAccountId);
    const result = evaluate(snap.input, policy, approvalEvidence(store, missionId, config.operators));
    const decision: GuardianDecision = { decisionId: newId("gdn"), missionId, evaluatedAt: nowIso(), ...result };
    store.insertGuardianDecision(decision);
    this.recordRun({ missionId, agent: "3ASES", mode: "DETERMINISTIC", status: decision.decision === "APPROVED" ? "DONE" : "BLOCKED", input: snap.input, summary: `${decision.decision} · risk ${decision.riskLevel}` });
    const eventType = decision.decision === "APPROVED" ? "GUARDIAN_APPROVED" : decision.decision === "BLOCKED" ? "GUARDIAN_BLOCKED" : "HUMAN_REVIEW_REQUIRED";
    const supplierName = snap.supplier?.name ?? snap.offer?.supplierId ?? null;
    proofs.recordEvent({
      missionId,
      eventType,
      agent: "3ASES",
      summary: `${decision.decision} (risk ${decision.riskLevel})${decision.reasons[0] ? ` — ${decision.reasons[0]}` : ""}`,
      payload: {
        decisionId: decision.decisionId,
        decision: decision.decision,
        policyVersion: decision.policyVersion,
        inputHash: decision.inputHash,
        riskLevel: decision.riskLevel,
        riskScore: decision.riskScore,
        riskFactors: decision.riskFactors,
        checks: decision.checks,
        reasons: decision.reasons,
        approvalId: decision.approvalId,
        offer: snap.offer ? { offerId: snap.offer.offerId, supplierId: snap.offer.supplierId, supplierName, totalPrice: snap.offer.totalPrice, invoiceId: snap.offer.invoiceId } : null,
        maximumBudget: snap.mission.maximumBudget,
        engine: "deterministic (no LLM)",
      },
    });
    const text =
      decision.decision === "APPROVED"
        ? `Everything checks out. APPROVED — risk ${decision.riskLevel}. All ${decision.checks.length} policy checks passed${decision.approvalId ? " (with human approval)" : ""}.`
        : decision.decision === "BLOCKED"
          ? `Stop! BLOCKED — ${decision.reasons.slice(0, 2).join(" · ")}`
          : `This is above my autonomous limit. HUMAN REVIEW REQUIRED — ${decision.reasons.slice(0, 2).join(" · ")}`;
    postFeed(store, missionId, "3ASES", decision.decision === "APPROVED" ? "success" : "alert", text, [decision.decision === "HUMAN_REVIEW_REQUIRED" ? "HUMAN REVIEW" : decision.decision, `RISK ${decision.riskLevel}`, "NO LLM"], { decision });
    return decision;
  }

  private async runKanawita(missionId: string, trigger: "AUTO" | "AFTER_HUMAN_APPROVAL") {
    this.currentAgent.set(missionId, "KANAWITA");
    const outcome = await this.kanawita.execute(missionId, trigger);
    this.recordRun({ missionId, agent: "KANAWITA", mode: "DETERMINISTIC", status: outcome.executed ? "DONE" : "BLOCKED", input: { missionId, trigger }, summary: outcome.executed ? `Payment ${outcome.payment?.status} (${outcome.payment?.mode})` : `Refused: ${outcome.reasons[0] ?? "unknown"}` });
  }

  private recordRun(r: { missionId: string; agent: AgentName; mode: ExecutionMode; status: AgentRun["status"]; input: unknown; summary: string; model?: string | null; fallbackReason?: string | null; latencyMs?: number | null }) {
    this.deps.store.upsertAgentRun({
      runId: newId("run"),
      missionId: r.missionId,
      agent: r.agent,
      mode: r.mode,
      status: r.status,
      inputHash: hashCanonical(r.input ?? null),
      outputSummary: r.summary.slice(0, 400),
      provider: r.mode === "REAL_AI" ? "anthropic" : null,
      model: r.model ?? null,
      fallbackReason: r.fallbackReason ?? null,
      latencyMs: r.latencyMs ?? null,
      timestamp: nowIso(),
    });
  }

  private fail(missionId: string, e: unknown) {
    logger.error("mission.pipeline_failed", { missionId, error: e });
    try {
      const m = this.deps.store.getMission(missionId);
      if (m && !["PAID", "BLOCKED", "REJECTED", "PAYMENT_FAILED"].includes(m.status)) this.deps.store.setMissionStatus(missionId, "FAILED");
      postFeed(this.deps.store, missionId, "SYSTEM", "alert", `Pipeline error: ${e instanceof Error ? e.message : String(e)}. No payment was made.`, ["ERROR"]);
    } catch {
      /* never crash the server */
    }
    this.currentAgent.set(missionId, null);
  }

  /** Constant-time PIN comparison with a lockout after 5 failures (60 s). */
  private checkPin(missionId: string, pin: string) {
    const expected = this.deps.config.operatorPin;
    if (!expected) throw new DomainError("APPROVALS_DISABLED", "Approvals are disabled: set DEMO_OPERATOR_PIN on the server", 503);
    const f = this.pinFailures.get(missionId);
    if (f && f.until > Date.now()) throw new DomainError("PIN_LOCKED", "Too many wrong PINs — try again in a minute", 429);
    const digest = (v: string) => createHash("sha256").update(v).digest();
    if (!timingSafeEqual(digest(pin), digest(expected))) {
      const count = (f?.count ?? 0) + 1;
      this.pinFailures.set(missionId, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      logger.warn("approval.bad_pin", { missionId, attempts: count });
      throw new DomainError("INVALID_PIN", "Invalid operator PIN", 403);
    }
    this.pinFailures.delete(missionId);
  }

  private mustGet(missionId: string): Mission {
    const m = this.deps.store.getMission(missionId);
    if (!m) throw new DomainError("NOT_FOUND", `Mission ${missionId} not found`, 404);
    return m;
  }
}

/** Strip internal demo fields (price lists etc.) before exposing a supplier. */
function publicSupplier(s: Supplier): Supplier {
  const { supplierId, name, region, serviceRegions, categories, verified, verificationSource, riskFlags, claims, isDemo } = s;
  return { supplierId, name, region, serviceRegions, categories, verified, verificationSource, riskFlags, claims, isDemo };
}
