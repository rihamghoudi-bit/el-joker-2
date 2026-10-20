import { type AiClient, AnthropicAiClient } from "./ai/aiClient";
import { ProofService } from "./audit/proofService";
import { type AppConfig, buildConfig } from "./config";
import { type LoadedPolicy, PolicyRegistry } from "./agents/guardian/policy";
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
  /** Default organization's policy. */
  policy: LoadedPolicy;
  /** Every organization's policy. */
  policies: PolicyRegistry;
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
  const policies = new PolicyRegistry(config.policyOverrides);
  const policy = policies.default;
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
      vaultAccountId: config.hedera.vaultConfigured ? config.hedera.vaultAccountId : null,
      approverPrivateKey: config.hedera.vaultConfigured ? config.hedera.approverPrivateKey : null,
      stablecoin: config.hedera.stablecoin,
    });
    await gw.init().catch((e) => logger.warn("hedera.init_failed", { error: e }));
    ledger = gw;
  } else {
    ledger = new SimulatedGateway(store);
  }

  const proofs = new ProofService(store, ledger, (missionId) => policies.forMission(store.getMission(missionId)).effectiveVersion, o.proofOptions);
  const missions = new MissionService({ config, store, ai, ledger, proofs, policies, stepDelayMs: o.stepDelayMs });
  missions.seedSuppliers();

  logger.info("app.bootstrapped", {
    ai: ai.available ? `REAL_AI ready (${ai.model})` : `FALLBACK only (${ai.unavailableReason})`,
    ledger: ledger.mode,
    topicId: ledger.topicId,
    policies: policies.list().map((p) => `${p.organizationId} ${p.effectiveVersion}`),
    vault: ledger.vault.enabled ? ledger.vault.accountId : "disabled",
    settlement: ledger.settlement.symbol,
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
    policies,
    close() {
      if (ledger instanceof HederaSdkGateway) ledger.close();
      store.close();
    },
  };
}
