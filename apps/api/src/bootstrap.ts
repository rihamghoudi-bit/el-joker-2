import { type AiClient, AnthropicAiClient } from "./ai/aiClient";
import { ProofService } from "./audit/proofService";
import { type AppConfig, buildConfig } from "./config";
import { loadPolicy } from "./agents/guardian/policy";
import { Store } from "./db/store";
import type { LedgerGateway } from "./hedera/gateway";
import { HederaSdkGateway } from "./hedera/sdkGateway";
import { SimulatedGateway } from "./hedera/simulatedGateway";
import { logger } from "./logger";
import { MissionService } from "./orchestrator/missionService";

export interface AppServices {
  config: AppConfig;
  store: Store;
  ai: AiClient;
  ledger: LedgerGateway;
  proofs: ProofService;
  missions: MissionService;
  policy: ReturnType<typeof loadPolicy>;
  close(): void;
}

export interface BootstrapOverrides {
  config?: AppConfig;
  store?: Store;
  ai?: AiClient;
  ledger?: (store: Store) => LedgerGateway;
  stepDelayMs?: number;
  proofOptions?: ConstructorParameters<typeof ProofService>[3];
}

export async function bootstrap(o: BootstrapOverrides = {}): Promise<AppServices> {
  const config = o.config ?? buildConfig();
  const store = o.store ?? new Store(config.databasePath);
  const policy = loadPolicy(config.policyOverrides);
  const ai = o.ai ?? new AnthropicAiClient(config.ai);

  let ledger: LedgerGateway;
  if (o.ledger) ledger = o.ledger(store);
  else if (config.hedera.live) {
    const gw = new HederaSdkGateway({
      accountId: config.hedera.accountId!,
      privateKey: config.hedera.privateKey!,
      topicId: config.hedera.topicId!,
      payeeAccountId: config.hedera.payeeAccountId,
      mirrorNodeUrl: config.hedera.mirrorNodeUrl,
    });
    await gw.init().catch((e) => logger.warn("hedera.init_failed", { error: e }));
    ledger = gw;
  } else {
    ledger = new SimulatedGateway(store);
  }

  const proofs = new ProofService(store, ledger, () => policy.effectiveVersion, o.proofOptions);
  const missions = new MissionService({ config, store, ai, ledger, proofs, policy, stepDelayMs: o.stepDelayMs });
  missions.seedSuppliers();

  logger.info("app.bootstrapped", {
    ai: ai.available ? `REAL_AI ready (${ai.model})` : `FALLBACK only (${ai.unavailableReason})`,
    ledger: ledger.mode,
    topicId: ledger.topicId,
    policy: policy.effectiveVersion,
    demoMode: config.demoMode,
  });

  return {
    config,
    store,
    ai,
    ledger,
    proofs,
    missions,
    policy,
    close() {
      if (ledger instanceof HederaSdkGateway) ledger.close();
      store.close();
    },
  };
}
