/** Resets local mission data and (re)seeds the fictional demo suppliers. Does not touch Hedera. */
import { buildConfig } from "../config";
import { Store } from "../db/store";
import { DEMO_SUPPLIERS } from "../seed/demoData";

const config = buildConfig();
if (!config.demoMode) {
  console.error("Refusing to reset data outside demo mode.");
  process.exit(1);
}
const store = new Store(config.databasePath);
store.resetAll();
for (const s of DEMO_SUPPLIERS) store.upsertSupplier(s);
console.log(`Seeded ${DEMO_SUPPLIERS.length} demo suppliers into ${config.databasePath} (mission data cleared).`);
store.close();
