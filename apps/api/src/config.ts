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
  DEMO_OPERATOR_PIN: optStr,

  AI_ENABLED: bool(true),
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  AI_TIMEOUT_MS: num(45_000),

  HEDERA_NETWORK: z.string().default("testnet"),
  /** "simulated" forces the local stand-in ledger even when credentials are present (offline rehearsal, previews). */
  LEDGER_MODE: z.enum(["auto", "simulated"]).default("auto"),
  HEDERA_ACCOUNT_ID: optStr,
  HEDERA_PRIVATE_KEY: optStr,
  HEDERA_TOPIC_ID: optStr,
  HEDERA_PAYEE_ACCOUNT_ID: optStr,
  HEDERA_MIRROR_NODE_URL: z.string().default("https://testnet.mirrornode.hedera.com"),
  /** 2-of-2 vault (operator key + approver key) holding the funds above the autonomous limit. */
  HEDERA_VAULT_ACCOUNT_ID: optStr,
  HEDERA_APPROVER_PRIVATE_KEY: optStr,
  /** HTS stablecoin used for settlement (full offer amount instead of scaled HBAR). */
  HEDERA_STABLECOIN_TOKEN_ID: optStr,
  HEDERA_STABLECOIN_SYMBOL: z.string().default("EJUSD"),
  HEDERA_STABLECOIN_DECIMALS: num(2),
  DEMO_SETTLEMENT_HBAR_PER_1000_USD: num(0.25),
  DEMO_SETTLEMENT_MAX_HBAR: num(10),
  TND_PER_USD: num(3.1),

  AUTONOMOUS_PAYMENT_LIMIT: num(5000),
  MAX_TRANSACTION_LIMIT: num(25000),
  HUMAN_APPROVAL_THRESHOLD: z.enum(["MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
});

export type AppConfig = ReturnType<typeof buildConfig>;

/** Documented demo PIN (README). Only used when DEMO_MODE=true and no DEMO_OPERATOR_PIN is set. */
export const DEFAULT_DEMO_PIN = "0619";

export function buildConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  if (parsed.HEDERA_NETWORK !== "testnet") {
    // Hard safety rule for the hackathon build: never touch mainnet.
    throw new Error(`HEDERA_NETWORK must be "testnet" (got "${parsed.HEDERA_NETWORK}")`);
  }
  const hederaLive = parsed.LEDGER_MODE !== "simulated" && Boolean(parsed.HEDERA_ACCOUNT_ID && parsed.HEDERA_PRIVATE_KEY && parsed.HEDERA_TOPIC_ID);
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
    /** Operator PIN for approvals. Demo mode falls back to a documented demo PIN; production requires an explicit one. */
    operatorPin: parsed.DEMO_OPERATOR_PIN ?? (parsed.DEMO_MODE && !production ? DEFAULT_DEMO_PIN : null),
    /** Demo assumption for budgets written in Tunisian dinars (mission currency stays USD). */
    tndPerUsd: parsed.TND_PER_USD,
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
      /** Scaled demo settlement: offer USD / 1000 * rate, capped. Keeps the paid amount tied to the authorized amount. */
      hbarPer1000Usd: parsed.DEMO_SETTLEMENT_HBAR_PER_1000_USD,
      maxSettlementHbar: parsed.DEMO_SETTLEMENT_MAX_HBAR,
      vaultAccountId: parsed.HEDERA_VAULT_ACCOUNT_ID,
      approverPrivateKey: parsed.HEDERA_APPROVER_PRIVATE_KEY,
      /** The vault is used only when both its account and the approver key are configured. */
      vaultConfigured: Boolean(parsed.HEDERA_VAULT_ACCOUNT_ID && parsed.HEDERA_APPROVER_PRIVATE_KEY),
      stablecoin: parsed.HEDERA_STABLECOIN_TOKEN_ID
        ? { tokenId: parsed.HEDERA_STABLECOIN_TOKEN_ID, symbol: parsed.HEDERA_STABLECOIN_SYMBOL, decimals: parsed.HEDERA_STABLECOIN_DECIMALS }
        : null,
    },
    policyOverrides: {
      autonomousLimitUsd: parsed.AUTONOMOUS_PAYMENT_LIMIT,
      maxTransactionUsd: parsed.MAX_TRANSACTION_LIMIT,
      humanReviewRiskLevel: parsed.HUMAN_APPROVAL_THRESHOLD,
    },
  };
}
