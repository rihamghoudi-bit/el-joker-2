import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root .env is the single source of configuration (apps/api/src -> ../../..).
const candidates = [path.resolve(here, "../../../.env"), path.resolve(here, "../../.env"), path.resolve(process.cwd(), ".env")];
for (const file of candidates) {
  if (existsSync(file)) {
    dotenv.config({ path: file, quiet: true });
    break;
  }
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));
const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().finite());
const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: num(4000),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_PATH: optStr,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DEMO_MODE: bool(true),
  DEMO_STEP_DELAY_MS: num(700),
  DEMO_OPERATORS: z.string().default("ops-lead,field-coordinator"),

  AI_ENABLED: bool(true),
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  AI_TIMEOUT_MS: num(45_000),

  HEDERA_NETWORK: z.string().default("testnet"),
  HEDERA_ACCOUNT_ID: optStr,
  HEDERA_PRIVATE_KEY: optStr,
  HEDERA_TOPIC_ID: optStr,
  HEDERA_PAYEE_ACCOUNT_ID: optStr,
  HEDERA_MIRROR_NODE_URL: z.string().default("https://testnet.mirrornode.hedera.com"),
  DEMO_SETTLEMENT_HBAR: num(1),

  AUTONOMOUS_PAYMENT_LIMIT: num(5000),
  MAX_TRANSACTION_LIMIT: num(25000),
  HUMAN_APPROVAL_THRESHOLD: z.enum(["MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
});

export type AppConfig = ReturnType<typeof buildConfig>;

export function buildConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  if (parsed.HEDERA_NETWORK !== "testnet") {
    // Hard safety rule for the hackathon build: never touch mainnet.
    throw new Error(`HEDERA_NETWORK must be "testnet" (got "${parsed.HEDERA_NETWORK}")`);
  }
  const hederaLive = Boolean(parsed.HEDERA_ACCOUNT_ID && parsed.HEDERA_PRIVATE_KEY && parsed.HEDERA_TOPIC_ID);
  const production = parsed.NODE_ENV === "production";
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    databasePath: parsed.DATABASE_PATH ?? path.resolve(here, "../data/eljoker.db"),
    logLevel: parsed.LOG_LEVEL,
    /** Demo-only actions (tamper, reset) are never available in production. */
    demoMode: parsed.DEMO_MODE && !production,
    demoStepDelayMs: parsed.DEMO_STEP_DELAY_MS,
    operators: parsed.DEMO_OPERATORS.split(",").map((s) => s.trim()).filter(Boolean),
    ai: {
      enabled: parsed.AI_ENABLED,
      apiKey: parsed.ANTHROPIC_API_KEY,
      model: parsed.ANTHROPIC_MODEL,
      timeoutMs: parsed.AI_TIMEOUT_MS,
    },
    hedera: {
      network: "testnet" as const,
      live: hederaLive,
      accountId: parsed.HEDERA_ACCOUNT_ID,
      privateKey: parsed.HEDERA_PRIVATE_KEY,
      topicId: parsed.HEDERA_TOPIC_ID,
      payeeAccountId: parsed.HEDERA_PAYEE_ACCOUNT_ID,
      mirrorNodeUrl: parsed.HEDERA_MIRROR_NODE_URL.replace(/\/$/, ""),
      demoSettlementHbar: parsed.DEMO_SETTLEMENT_HBAR,
    },
    policyOverrides: {
      autonomousLimitUsd: parsed.AUTONOMOUS_PAYMENT_LIMIT,
      maxTransactionUsd: parsed.MAX_TRANSACTION_LIMIT,
      humanReviewRiskLevel: parsed.HUMAN_APPROVAL_THRESHOLD,
    },
  };
}
