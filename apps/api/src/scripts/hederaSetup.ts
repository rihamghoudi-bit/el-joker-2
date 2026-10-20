/**
 * One-time Hedera TESTNET setup. Run it from your own terminal (it needs gRPC access to Hedera nodes, port 50211).
 *
 *   npm run hedera:setup                              topic only (if HEDERA_TOPIC_ID is empty)
 *   npm run hedera:setup -- --payee                   + a demo payee account (receives HBAR)
 *   npm run hedera:setup -- --vault                   + the 2-of-2 vault (agents key + a new approver key)
 *   npm run hedera:setup -- --stablecoin              + the EJTND demo dinar token (HTS), a payee that accepts it,
 *                                                       and 1,000,000 EJTND moved into the vault
 *   npm run hedera:setup -- --vault --stablecoin      both (recommended)
 *
 * The topic's submit key is the operator key, so nobody else can post "proofs" to it.
 * --vault and --stablecoin write their values into .env themselves (the approver key must be kept, so it is written,
 * never printed). Nothing else ever writes .env, and no private key is ever printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  KeyList,
  PrivateKey,
  TokenCreateTransaction,
  TokenId,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";
import { buildConfig } from "../config";
import { privateKeyCandidates } from "../hedera/sdkGateway";
import { MirrorNodeClient } from "../hedera/mirror";

const config = buildConfig();
const { accountId, privateKey } = config.hedera;
if (!accountId || !privateKey) {
  console.error("Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env first (testnet account from https://portal.hedera.com).");
  process.exit(1);
}
const args = new Set(process.argv.slice(2));

/* ---------- .env (same file the API reads) ---------- */
const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = [path.resolve(here, "../../../../.env"), path.resolve(here, "../../.env"), path.resolve(process.cwd(), ".env")].find((f) => existsSync(f));
function writeEnv(values: Record<string, string>, secretKeys: string[] = []) {
  if (!envFile) throw new Error("No .env file found to write to");
  let text = readFileSync(envFile, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
    console.log(`  .env  ${key}=${secretKeys.includes(key) ? "(written, not shown)" : value}`);
  }
  writeFileSync(envFile, text);
}

/* ---------- client ---------- */
const client = Client.forTestnet();
const candidates = privateKeyCandidates(privateKey);
let key: PrivateKey = candidates[0]!;
if (candidates.length > 1) {
  const acct = await new MirrorNodeClient(config.hedera.mirrorNodeUrl).getAccountKey(accountId);
  key = candidates.find((k) => acct?.key.toLowerCase().endsWith(k.publicKey.toStringRaw().toLowerCase())) ?? key;
}
const operator = AccountId.fromString(accountId);
client.setOperator(operator, key);

const printLines: string[] = [];
try {
  /* ---------- HCS topic ---------- */
  if (!config.hedera.topicId) {
    const tx = await new TopicCreateTransaction().setTopicMemo("EL JOKER 2.0 decision proofs (testnet)").setSubmitKey(key.publicKey).setAdminKey(key.publicKey).execute(client);
    const topicId = (await tx.getReceipt(client)).topicId!.toString();
    console.log(`Created HCS topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
    printLines.push(`HEDERA_TOPIC_ID=${topicId}`);
  } else {
    console.log(`HEDERA_TOPIC_ID already set (${config.hedera.topicId}) — not creating a new topic.`);
  }

  /* ---------- 2-of-2 vault ---------- */
  let vaultId = config.hedera.vaultConfigured ? config.hedera.vaultAccountId : null;
  if (args.has("--vault")) {
    if (vaultId) {
      console.log(`Vault already configured (${vaultId}) — not creating a new one.`);
    } else {
      // The approver key is the human side of the vault. In this demo the server keeps it and uses it only after an
      // authorized operator approves with the PIN; in production it lives in the approver's own wallet.
      const approverKey = PrivateKey.generateED25519();
      const threshold = new KeyList([key.publicKey, approverKey.publicKey], 2);
      const tx = await new AccountCreateTransaction()
        .setKeyWithoutAlias(threshold)
        .setInitialBalance(new Hbar(25))
        .setMaxAutomaticTokenAssociations(10)
        .setAccountMemo("EL JOKER vault: 2-of-2 (agents + approver), testnet")
        .execute(client);
      vaultId = (await tx.getReceipt(client)).accountId!.toString();
      console.log(`Created 2-of-2 vault ${vaultId} with 25 HBAR  https://hashscan.io/testnet/account/${vaultId}`);
      writeEnv({ HEDERA_VAULT_ACCOUNT_ID: vaultId, HEDERA_APPROVER_PRIVATE_KEY: approverKey.toStringDer() }, ["HEDERA_APPROVER_PRIVATE_KEY"]);
    }
  }

  /* ---------- HTS stablecoin ---------- */
  let payeeId = config.hedera.payeeAccountId;
  if (args.has("--stablecoin")) {
    // A token created before the switch to dinars (EJUSD) is replaced by the dinar token.
    let tokenId = config.hedera.stablecoin?.symbol === "EJTND" ? config.hedera.stablecoin.tokenId : null;
    if (config.hedera.stablecoin && !tokenId) console.log(`Existing token ${config.hedera.stablecoin.tokenId} is ${config.hedera.stablecoin.symbol}, not EJTND — creating the dinar token.`);
    if (tokenId) {
      console.log(`Stablecoin already configured (${tokenId}) — not creating a new one.`);
    } else {
      // Fixed supply (no supply key), no admin key: nobody can mint more or change the token afterwards.
      const tx = await new TokenCreateTransaction()
        .setTokenName("EL JOKER Demo Dinar")
        .setTokenSymbol("EJTND")
        .setTokenMemo("Demo dinar token for EL JOKER (testnet, no real value)")
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(3) // millimes, like the Tunisian dinar
        .setInitialSupply(100_000_000_000) // 100,000,000.000 EJTND
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100_000_000_000)
        .setTreasuryAccountId(operator)
        .execute(client);
      tokenId = (await tx.getReceipt(client)).tokenId!.toString();
      console.log(`Created HTS token EJTND ${tokenId} (100,000,000 TND, fixed supply)  https://hashscan.io/testnet/token/${tokenId}`);
      writeEnv({ HEDERA_STABLECOIN_TOKEN_ID: tokenId, HEDERA_STABLECOIN_SYMBOL: "EJTND", HEDERA_STABLECOIN_DECIMALS: "3" });

      // A payee that can receive the token without signing an association (its key is generated and discarded).
      const payeeTx = await new AccountCreateTransaction()
        .setKeyWithoutAlias(PrivateKey.generateED25519().publicKey)
        .setInitialBalance(new Hbar(0))
        .setMaxAutomaticTokenAssociations(10)
        .setAccountMemo("EL JOKER demo supplier payee (testnet)")
        .execute(client);
      payeeId = (await payeeTx.getReceipt(client)).accountId!.toString();
      console.log(`Created demo payee ${payeeId} (accepts EJTND)  https://hashscan.io/testnet/account/${payeeId}`);
      writeEnv({ HEDERA_PAYEE_ACCOUNT_ID: payeeId });
    }
    if (vaultId) {
      const units = 1_000_000_000; // 1,000,000.000 EJTND
      const fund = await new TransferTransaction()
        .addTokenTransfer(TokenId.fromString(tokenId), operator, -units)
        .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(vaultId), units)
        .setTransactionMemo("EL JOKER: fund the vault")
        .execute(client);
      await fund.getReceipt(client);
      console.log(`Moved 1,000,000 EJTND into the vault ${vaultId}`);
    }
  }

  /* ---------- HBAR payee ---------- */
  if (args.has("--payee") && !payeeId) {
    // The demo payee only RECEIVES funds; its key is generated and discarded on purpose.
    const tx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(PrivateKey.generateED25519().publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(10)
      .setAccountMemo("EL JOKER demo supplier payee (testnet)")
      .execute(client);
    const payee = (await tx.getReceipt(client)).accountId!.toString();
    console.log(`Created demo payee account ${payee}  https://hashscan.io/testnet/account/${payee}`);
    printLines.push(`HEDERA_PAYEE_ACCOUNT_ID=${payee}`);
  }
} finally {
  client.close();
}

if (printLines.length) {
  console.log("\nAdd these lines to your .env (not committed):\n");
  for (const l of printLines) console.log(l);
}
console.log("\nRestart the app (npm run demo) to use the new values.");
