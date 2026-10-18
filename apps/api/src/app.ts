import { ApprovalRequest, CreateMissionRequest, OrganizationId, organizationOf, type PublicConfig, type ScenarioInfo } from "@eljoker/shared";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppServices } from "./bootstrap";
import { logger } from "./logger";
import { DomainError } from "./orchestrator/missionService";
import { SCENARIOS } from "./seed/demoData";

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(s: AppServices) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: s.config.webOrigin }));
  app.use(express.json({ limit: "100kb" }));
  app.use((req, _res, next) => {
    if (req.path !== "/api/health" && req.method !== "GET") logger.info("http.request", { method: req.method, path: req.path });
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ledger: s.ledger.mode, ai: s.ai.available ? "REAL_AI_READY" : "FALLBACK_ONLY", time: new Date().toISOString() });
  });

  app.get("/api/config", (_req, res) => {
    const body: PublicConfig = {
      appName: "EL JOKER 2.0 — 5ALIHA 3LINA",
      demoMode: s.config.demoMode,
      ai: { enabled: s.config.ai.enabled, configured: s.ai.available, provider: "anthropic", model: s.ai.model },
      hedera: {
        mode: s.ledger.mode,
        network: s.ledger.mode === "LIVE_TESTNET" ? "testnet" : "simulated",
        topicId: s.ledger.mode === "LIVE_TESTNET" ? s.ledger.topicId : null,
        operatorAccountId: s.ledger.mode === "LIVE_TESTNET" ? s.config.hedera.accountId : null,
        payeeAccountId: s.ledger.payeeAccountId,
        mirrorNodeUrl: s.config.hedera.mirrorNodeUrl,
        topicHashscanUrl: s.ledger.hashscanTopicUrl(),
        vault: {
          enabled: s.ledger.vault.enabled,
          accountId: s.ledger.vault.accountId,
          threshold: "2-of-2 (agents + approver)",
          hashscanUrl: s.ledger.hashscanAccountUrl(s.ledger.vault.accountId),
        },
      },
      payment: {
        hbarPer1000Usd: s.config.hedera.hbarPer1000Usd,
        maxSettlementHbar: s.config.hedera.maxSettlementHbar,
        asset: s.ledger.settlement.kind,
        symbol: s.ledger.settlement.symbol,
        tokenId: s.ledger.settlement.kind === "TOKEN" ? s.ledger.settlement.tokenId : null,
        tokenHashscanUrl: s.ledger.settlement.kind === "TOKEN" ? s.ledger.hashscanTokenUrl(s.ledger.settlement.tokenId) : null,
      },
      policy: {
        version: s.policy.effectiveVersion,
        autonomousLimitUsd: s.policy.autonomousLimitUsd,
        maxTransactionUsd: s.policy.maxTransactionUsd,
        humanReviewRiskLevel: s.policy.humanReviewRiskLevel,
        allowedRegions: s.policy.allowedRegions,
        allowedCategories: s.policy.allowedCategories,
      },
      policies: s.policies.summaries(),
      operators: s.config.operators,
      operatorAuth: s.config.operatorPin ? "DEMO_PIN" : "DISABLED",
    };
    res.json(body);
  });

  /** A spending policy, by organization (?org=ACME_PROCUREMENT). Defaults to the NGO. */
  app.get("/api/policy", (req, res) => {
    const org = OrganizationId.catch("NGO_RELIEF").parse(req.query.org);
    res.json(s.policies.get(org));
  });

  app.get("/api/scenarios", (_req, res) => {
    const list: ScenarioInfo[] = SCENARIOS.map(({ draft: _d, ...info }) => info);
    res.json(list);
  });

  app.post(
    "/api/scenarios/:id/run",
    wrap(async (req, res) => {
      const out = await s.missions.runScenario(String(req.params.id));
      res.status(202).json(out);
    }),
  );

  app.get("/api/missions", (_req, res) => {
    res.json(
      s.store.listMissions(30).map((m) => ({ missionId: m.missionId, description: m.description, location: m.location, maximumBudget: m.maximumBudget, status: m.status, scenarioId: m.scenarioId, organizationId: organizationOf(m), createdAt: m.createdAt })),
    );
  });

  app.post(
    "/api/missions",
    wrap(async (req, res) => {
      const body = CreateMissionRequest.parse(req.body);
      const out = await s.missions.createMission(body);
      res.status(out.status === "NEEDS_INFORMATION" ? 200 : 202).json(out);
    }),
  );

  app.get(
    "/api/missions/:id",
    wrap((req, res) => {
      res.json(s.missions.getState(String(req.params.id), { includePayloads: req.query.payloads === "1" }));
    }),
  );

  app.post(
    "/api/missions/:id/approvals",
    wrap(async (req, res) => {
      const body = ApprovalRequest.parse(req.body);
      res.json(await s.missions.submitApproval(String(req.params.id), body));
    }),
  );

  /** Scenario C: replay exactly the same payment. Always goes through KANAWITA's checks. */
  app.post(
    "/api/missions/:id/payments/replay",
    wrap(async (req, res) => {
      const out = await s.missions.replayPayment(String(req.params.id));
      res.status(out.executed ? 200 : 409).json(out);
    }),
  );

  /**
   * Public proof bundle: the raw evidence of every event plus where its proof lives on Hedera. Read-only. The public
   * verifier recomputes everything in the browser and checks it against the Mirror Node, so it never has to trust us.
   */
  app.get(
    "/api/public/missions/:id/bundle",
    wrap(async (req, res) => {
      res.json(await s.missions.getProofBundle(String(req.params.id)));
    }),
  );

  app.post(
    "/api/missions/:id/verify",
    wrap(async (req, res) => {
      res.json(await s.missions.verifyMission(String(req.params.id)));
    }),
  );

  app.get(
    "/api/missions/:id/events/:eventId/proof",
    wrap((req, res) => {
      const proof = s.proofs.getProof(String(req.params.eventId));
      if (!proof || proof.event.missionId !== req.params.id) throw new DomainError("NOT_FOUND", "Event not found", 404);
      res.json(proof);
    }),
  );

  /** DEMO/DEVELOPMENT ONLY — disabled when DEMO_MODE=false or NODE_ENV=production. */
  app.post(
    "/api/missions/:id/tamper",
    wrap((req, res) => {
      const { mode } = z.object({ mode: z.enum(["EDIT_EVIDENCE", "REWRITE_HASHES", "DELETE_LAST_EVENT"]).default("EDIT_EVIDENCE") }).parse(req.body ?? {});
      res.json(s.missions.tamper(String(req.params.id), mode));
    }),
  );

  app.post(
    "/api/demo/reset",
    wrap((_req, res) => {
      if (!s.config.demoMode) throw new DomainError("DEMO_ONLY", "Reset is only available in demo mode", 403);
      s.store.resetAll();
      s.missions.seedSuppliers();
      res.json({ ok: true });
    }),
  );

  app.use((_req, res) => res.status(404).json({ error: "Not found", code: "NOT_FOUND" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", code: "VALIDATION_ERROR", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      return;
    }
    if (err instanceof DomainError) {
      res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Malformed JSON", code: "BAD_JSON" });
      return;
    }
    logger.error("http.unhandled_error", { error: err });
    res.status(500).json({ error: "Internal error", code: "INTERNAL" });
  });

  return app;
}
