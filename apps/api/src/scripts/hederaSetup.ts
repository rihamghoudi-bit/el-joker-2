/**
 * One-time Hedera TESTNET setup.
 *  - Creates the HCS proof topic (submit key = operator key, so nobody else can post "proofs" to it)
 *  - Optionally creates a demo payee account (receives the scaled demo settlement)
 * Prints the values to add to .env. It never writes .env and never prints private keys.
 *
 * Usage: npm run hedera:setup            (topic only, if HEDERA_TOPIC_ID is empty)
 *        npm run hedera:setup -- --payee (also create a demo payee account)
 */
import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";
import { buildConfig } from "../config";
import { privateKeyCandidates } from "../hedera/sdkGateway";
import { MirrorNodeClient } from "../hedera/mirror";

const config = buildConfig();
const { accountId, privateKey } = config.hedera;
if (!accountId || !privateKey) {
  console.error("Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in .env first (testnet account from https://portal.hedera.com).");
  process.exit(1);
}

const client = Client.forTestnet();
const candidates = privateKeyCandidates(privateKey);
let key: PrivateKey = candidates[0]!;
if (candidates.length > 1) {
  const acct = await new MirrorNodeClient(config.hedera.mirrorNodeUrl).getAccountKey(accountId);
  key = candidates.find((k) => acct?.key.toLowerCase().endsWith(k.publicKey.toStringRaw().toLowerCase())) ?? key;
}
client.setOperator(AccountId.fromString(accountId), key);

const lines: string[] = [];
try {
  if (!config.hedera.topicId) {
    const tx = await new TopicCreateTransaction().setTopicMemo("EL JOKER 2.0 decision proofs (testnet)").setSubmitKey(key.publicKey).setAdminKey(key.publicKey).execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId!.toString();
    console.log(`Created HCS topic ${topicId}  https://hashscan.io/testnet/topic/${topicId}`);
    lines.push(`HEDERA_TOPIC_ID=${topicId}`);
  } else {
    console.log(`HEDERA_TOPIC_ID already set (${config.hedera.topicId}) — not creating a new topic.`);
  }

  if (process.argv.includes("--payee") && !config.hedera.payeeAccountId) {
    // The demo payee only RECEIVES funds; its key is generated and discarded on purpose.
    const payeeKey = PrivateKey.generateED25519();
    const tx = await new AccountCreateTransaction().setKeyWithoutAlias(payeeKey.publicKey).setInitialBalance(new Hbar(0)).setAccountMemo("EL JOKER demo supplier payee (testnet)").execute(client);
    const receipt = await tx.getReceipt(client);
    const payee = receipt.accountId!.toString();
    console.log(`Created demo payee account ${payee}  https://hashscan.io/testnet/account/${payee}`);
    lines.push(`HEDERA_PAYEE_ACCOUNT_ID=${payee}`);
  }
} finally {
  client.close();
}

if (lines.length) {
  console.log("\nAdd these lines to your .env (not committed):\n");
  for (const l of lines) console.log(l);
}
