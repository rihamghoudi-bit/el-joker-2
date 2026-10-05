import type { AiClient } from "../src/ai/aiClient";
import { type AppServices, bootstrap } from "../src/bootstrap";
import { buildConfig } from "../src/config";
import { Store } from "../src/db/store";
import type { LedgerGateway } from "../src/hedera/gateway";
import { SimulatedGateway } from "../src/hedera/simulatedGateway";

export interface TestAppOptions {
  env?: Record<string, string>;
  ai?: AiClient;
  ledger?: (store: Store) => LedgerGateway;
}

/** Fully wired app on an in-memory DB with the SIMULATED ledger (never touches the network or real funds). */
export async function makeTestApp(o: TestAppOptions = {}): Promise<AppServices & { sim: SimulatedGateway | null }> {
  const config = buildConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", AI_ENABLED: "false", DEMO_MODE: "true", DEMO_STEP_DELAY_MS: "0", ...o.env } as NodeJS.ProcessEnv);
  const store = new Store(":memory:");
  let sim: SimulatedGateway | null = null;
  const services = await bootstrap({
    config,
    store,
    ai: o.ai,
    ledger: o.ledger ?? ((s) => (sim = new SimulatedGateway(s))),
    stepDelayMs: 0,
    proofOptions: { retryDelayMs: 1, mirrorAttempts: 1, mirrorDelayMs: 1 },
  });
  return Object.assign(services, { sim });
}

export async function runScenarioToRest(app: AppServices, id: string) {
  const { missionId } = await app.missions.runScenario(id);
  await app.missions.idle(missionId);
  return { missionId, state: app.missions.getState(missionId) };
}

export const eventTypes = (app: AppServices, missionId: string) => app.store.listAuditEvents(missionId).map((e) => e.eventType);
