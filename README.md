# EL JOKER 2.0 — 5ALIHA 3LINA

**Team Chain619 · Hedera Hackathon** · *“Autonomous, but never uncontrolled.”*

**The control layer for AI agents that spend money.** AI agents are starting to buy, book and pay. EL JOKER lets an organization use one for its purchases without handing it the money: **one AI researcher recommends, four rule-based agents verify, decide and pay**, a human co-signs anything above the limit, and every decision is proven on Hedera.

| Agent | Role | Property |
|---|---|---|
| **LEM3ALEM** | Coordinator / planner | Turns the request into a validated mission; never invents critical facts |
| **LEMHAF** | AI research (Claude) | Ranks supplier offers and explains trade-offs — **recommends only** |
| **NASNES** | Independent verifier | Deterministic checks of registry, evidence, arithmetic, invoices and the AI's own claims |
| **3ASES** | Guardian | Versioned deterministic policy (one per organization) + risk engine. **No LLM.** |
| **KANAWITA** | Payment executor | Re-checks authorization itself; above the limit it can only *lock* money in the vault |

> AI proposes → NASNES verifies → 3ASES decides → a human co-signs on Hedera above the limit → KANAWITA pays only when authorized → Hedera proves.

### How Hedera is used

| Hedera service | What EL JOKER does with it |
|---|---|
| **Consensus Service (HCS)** | Every decision is canonicalized, hashed (SHA-256), hash-linked to the previous one and published on topic `0.0.11007004` — only ids and hashes, no personal data or prices |
| **Scheduled transactions + threshold keys** | Above the autonomous limit the money sits in a **2-of-2 vault** (agents key + approver key). Kanawita creates a Hedera *schedule* signed by the agents only; **Hedera itself** executes the transfer once the approver co-signs. A rejection deletes the schedule. The agents' key alone can never move the vault's funds |
| **Token Service (HTS)** | Optional **EJTND** demo dinar token (fixed supply, 3 decimals like millimes): payments settle the **full offer amount in dinars** (e.g. 12,450 EJTND) instead of a scaled HBAR amount |
| **Crypto transfers** | Payments within the autonomous limit, from the agents' account (EJTND or scaled HBAR) |
| **Mirror Node** | Independent read-back: the server's own verifier *and* the **public verifier page**, which reads Hedera straight from the visitor's browser |

### One engine, any organization

The agents and the proof layer are the same for every organization; only the **policy** changes. Two are included:

| Organization | Policy | Autonomous limit | Allowed |
|---|---|---|---|
| **South Tunisia Relief Network** (demo NGO) | `policy.json` 2.1.0 | 15,000 TND | water, medicine, food, hygiene, shelter · southern regions |
| **ACME Tunisia** (demo company) | `policy.acme.json` 1.1.0 | 6,000 TND | electronics, office supplies · Tunis, Sousse, Sfax |

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Jury demo script: [docs/DEMO.md](docs/DEMO.md) · Status & decisions: [PROJECT_STATUS.md](PROJECT_STATUS.md)

---

## Quick start

Requirements: **Node.js ≥ 22.13** (developed on Node 24; uses the built-in `node:sqlite`), npm 10+.

```bash
npm install
cp .env.example .env      # fill in values (see below) — optional for a first run
npm run dev               # API http://localhost:4000 · UI http://localhost:3000
```

Without credentials everything runs in a clearly labeled mode: **AI · fallback** (rule-based ranking) and **Hedera · simulated** (local stand-in ledger and vault: no transaction ids, no HashScan links). Nothing pretends to be real. `LEDGER_MODE=simulated` forces that mode even when `.env` holds credentials (offline rehearsal).

**For a live demo use the production build** (faster start, no hot-reload surprises):

```bash
npm run demo              # = npm run build && npm start
```

### Enable real Hedera testnet

1. Create a testnet account at <https://portal.hedera.com>; put `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` in `.env` (DER or hex; ECDSA/ED25519 auto-detected against the Mirror Node).
2. Create the proof topic, the 2-of-2 vault and the EJTND dinar token — **run this from your own terminal** (it needs gRPC access to Hedera nodes, port 50211):
   ```bash
   npm run hedera:setup -- --vault --stablecoin
   ```
   - prints `HEDERA_TOPIC_ID=…` if you have no topic yet (add it to `.env`);
   - `--vault` creates the vault account (threshold key 2-of-2: your operator key + a **new approver key**, 25 HBAR) and **writes** `HEDERA_VAULT_ACCOUNT_ID` and `HEDERA_APPROVER_PRIVATE_KEY` into `.env` (the key is written, never printed);
   - `--stablecoin` creates the **EJTND** token (100,000,000 TND, 3 decimals, fixed supply, no admin key), a payee account that accepts it, moves 1,000,000 EJTND into the vault and writes `HEDERA_STABLECOIN_TOKEN_ID` and `HEDERA_PAYEE_ACCOUNT_ID` into `.env`.
   - `--payee` alone creates an HBAR-only demo payee.
3. Restart. The header shows **Hedera testnet · 0.0.x**, **Vault 2-of-2 · 0.0.x** and **Pays in EJTND (HTS)**.

`HEDERA_NETWORK` must be `testnet`; any other value refuses to start.

### Enable real AI

Set `ANTHROPIC_API_KEY` (optionally `ANTHROPIC_MODEL`, default `claude-opus-5-5`). The header shows **AI · model**; Lemhaf's messages show `REAL AI · <model>`. If a call fails (timeout, rate limit, refusal, invalid output) Lemhaf falls back and says why.

---

## Using the app

1. **Landing** → *Go for EL JOKER* (or *Verify a mission yourself*).
2. **Chat**: a ready-made request is already in the message box — press send (↑ or Enter). Chips **A–G** (relief NGO) and **H–I** (ACME) swap in another scenario; edited text is sent as a free-text mission (budgets in dinars; a budget written in dollars is converted at `TND_PER_USD`; text naming “ACME” goes to ACME's policy).
3. Watch the agents talk; the right panel shows the key numbers, **Live Hedera proofs** and actions (*Verify against Hedera*, *Replay payment (attack)*, *Open the public verifier*).
4. **Above the limit** (scenarios E and I): Kanawita locks the payment in the vault (**1 of 2 signatures**). An approval card appears — choose an operator, give a reason and enter the **operator PIN** (demo default **`0619`**, override with `DEMO_OPERATOR_PIN`). *Approve* adds the approver's signature and Hedera executes the transfer; *Reject* deletes the schedule.
5. **Proof & verify** tab: *Verify against Hedera* → then *Simulate local tampering*, *Insider rewrites hashes too* or *Delete last event* → *Verify* again.
6. **Public verifier** (`/verify?mission=msn_…`): the visitor's browser downloads the server's claims, reads the proofs **directly from the Mirror Node**, recomputes every SHA-256 with Web Crypto and checks payments and vault schedules. No trust in the EL JOKER server needed.
7. **Motion: on/off** (top bar) turns the animated backdrop and blur off for projectors / low-end laptops.

## The live scenarios

| | Scenario | Expected result |
|---|---|---|
| **A** | Approved — 500 people, Gabès, 15,000 TND | Verified supplier → APPROVED (risk LOW) → paid from the agents' account (12,450 EJTND, or 0.996 ℏ without the token) → 6 proofs → PROOF VERIFIED |
| **B** | Budget block — same mission, 300 TND | 3ASES BLOCKED (budget) → no payment → `GUARDIAN_BLOCKED` on HCS |
| **C** | Duplicate payment attack | Replay → HTTP 409 (“Mission is already PAID / idempotency key used”) → `PAYMENT_BLOCKED` on HCS; still exactly one payment |
| **D** | Unverified supplier — 12-hour rush | Lemhaf picks the cheap express broker → NASNES REJECTED (not in registry, no license, implausible prices) → BLOCKED |
| **E** | Above the limit — 2,000 people, Médenine, 60,000 TND | 49,800 TND > 15,000 TND → HUMAN_REVIEW_REQUIRED → payment **locked in the vault** (`PAYMENT_SCHEDULED`, 1 of 2) → operator + PIN approves → approver co-signs → Hedera executes → paid (reject → schedule deleted, `PAYMENT_CANCELLED`) |
| **F** | Tampering detection | Verify (VALID) → edit evidence / rewrite the local hash chain / delete the last event → Verify → **TAMPERING DETECTED** (also in the public verifier) |
| **G** | Recycled invoice — Kairouan, 13,500 TND | A *verified*, cheaper supplier reuses invoice `INV-KQS-2026-0042` already used by an earlier mission → NASNES REJECTED → BLOCKED |
| **H** | ACME · office supplies — Tunis, 4,500 TND | Same agents, **ACME policy 1.1.0** → 3,420 TND within ACME's 6,000 TND limit → APPROVED → paid autonomously |
| **I** | ACME · 12 laptops + 12 monitors — 45,000 TND | 35,460 TND > ACME's 6,000 TND limit → human review → vault → co-signed → paid |

## Commands

| Command | What |
|---|---|
| `npm run dev` | API (tsx watch) + UI (next dev) |
| `npm run demo` | Production build + start (recommended on stage) |
| `npm run build` / `npm start` | API bundle + Next.js production build / run them |
| `npm run typecheck` | `tsc --noEmit` for shared, api, web |
| `npm test` | 108 unit / integration / scenario tests — in-memory DB + simulated ledger and vault, **never spends funds** |
| `npm run test:e2e` | 7 browser tests (Playwright, uses the installed Microsoft Edge) against the running app |
| `npm run test:testnet` | Opt-in live Hedera testnet tests (needs all `HEDERA_*`; with the vault configured, also the live 2-of-2 schedule) |
| `npm run demo:check` | Runs every scenario (A–I + deleted-event check + independent public verification) against the running API |
| `npm run hedera:setup` | Topic (`-- --vault --stablecoin --payee` for the rest, see above) |
| `npm run seed` | Clear mission history and re-seed demo data (demo mode only) |

## Environment variables

See [.env.example](.env.example). Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Real AI path (server-side only) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for Lem3alem (free text) and Lemhaf |
| `AI_ENABLED` | `true` | Force fallback when `false` |
| `HEDERA_NETWORK` | `testnet` | Must be `testnet` |
| `LEDGER_MODE` | `auto` | `simulated` forces the stand-in ledger even with credentials |
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | — | Testnet operator (the agents' key) |
| `HEDERA_TOPIC_ID` | — | HCS proof topic |
| `HEDERA_PAYEE_ACCOUNT_ID` | — | Receives the demo settlement |
| `HEDERA_VAULT_ACCOUNT_ID` / `HEDERA_APPROVER_PRIVATE_KEY` | — | 2-of-2 vault and the approver's key (written by `hedera:setup -- --vault`) |
| `HEDERA_STABLECOIN_TOKEN_ID` / `_SYMBOL` / `_DECIMALS` | — / `EJTND` / `3` | HTS settlement token in dinars (full offer amount) |
| `DEMO_SETTLEMENT_HBAR_PER_1000_TND` / `DEMO_SETTLEMENT_MAX_HBAR` | `0.08` / `10` | HBAR settlement when no token is set: offer TND / 1000 × rate, capped |
| `AUTONOMOUS_PAYMENT_LIMIT_TND` | `15000` | NGO policy: above ⇒ human review (ACME's limit lives in its policy file) |
| `MAX_TRANSACTION_LIMIT_TND` | `75000` | NGO policy: above ⇒ blocked |
| `HUMAN_APPROVAL_THRESHOLD` | `HIGH` | NGO policy: risk level requiring a human |
| `DEMO_OPERATORS` | `ops-lead,field-coordinator` | Operators allowed to approve |
| `DEMO_OPERATOR_PIN` | — (demo: `0619`) | PIN for approvals; required when `DEMO_MODE=false` |
| `TND_PER_USD` | `3.1` | Demo conversion for budgets written in dollars (converted to dinars) |
| `DEMO_MODE` | `true` | Enables tamper simulation + reset; always off when `NODE_ENV=production` |

## Verifying on HashScan / Mirror Node yourself

1. **Public verifier**: open `/verify?mission=<id>` — everything below is done by your browser.
2. **Audit trail** tab: each event shows topic id, sequence number and a HashScan link to its HCS submit transaction.
3. Raw proof: `https://testnet.mirrornode.hedera.com/api/v1/topics/<TOPIC_ID>/messages/<SEQUENCE>` — `message` is base64; decoding gives `{"e": eventId, "h": evidenceHash, "eh": eventHash, "ph": previousEventHash, "m": missionId, …}`.
4. Canonicalize an event's off-chain evidence (sorted keys, no whitespace) and SHA-256 it — it must equal `h`. The bundle at `/api/public/missions/<id>/bundle` gives the raw evidence.
5. Vault payments: `https://testnet.mirrornode.hedera.com/api/v1/schedules/<SCHEDULE_ID>` shows `executed_timestamp` and the signatures; HashScan: `/schedule/<id>`.
6. Or press **Verify against Hedera** in the app: it lists *all* of the mission's proofs on the topic, matches them to local events by `eventId`, recomputes every hash, checks the chain links — and reports any proof whose local event was deleted.

## Security controls

- **Secrets** only in `.env` (git-ignored); `.env.example` has placeholders. The browser only talks to Next.js, which proxies `/api` — no keys client-side. The logger redacts key-like values. `hedera:setup` writes the approver key to `.env` and never prints it.
- **Testnet only** (hard check at startup; `Client.forTestnet()`).
- **3ASES** is a pure deterministic function (a test asserts it imports no AI/network modules and uses no clock/randomness).
- **Vault**: funds above the autonomous limit sit in an account whose key is a 2-of-2 threshold key. The agents can only create a schedule (1 signature); the transfer cannot execute without the approver's signature, and the schedule is deleted on rejection. Locking the payment does not change the facts the approval is bound to.
- **KANAWITA** independently re-runs 3ASES and all payment preconditions, and waits for the authorization proof to be anchored; DB unique constraints make duplicate payments impossible; transfers are single-shot (no blind retries; receipts are re-queried for the same transaction id).
- **Human approvals**: authorized operator + server-checked PIN (constant-time compare, lockout after 5 failures), bound to the Guardian input hash and policy version; stale or unauthorized approvals are ignored; one decision per mission.
- **Tamper evidence**: edited evidence, recomputed local hash chains, altered anchor metadata and deleted events are all detected against the ledger — by the server and by the public verifier in the browser.
- **On-chain data is minimal**: ids, hashes, event type, policy version, timestamp. No beneficiary data, prices or documents.
- **Demo-only endpoints** (tamper, reset) are disabled when `DEMO_MODE=false` or `NODE_ENV=production`.
- **AI hygiene**: structured output validated twice; registry status deliberately hidden from the AI; no chain-of-thought stored (provider, model, mode, input hash, summary only).

## Honest limitations

- Suppliers, registry entries, reference prices, the marketplace, both organizations and the earlier "history" invoice are **fictional demo data**.
- **EJTND** is a demo token we created on testnet (1 token = 1 TND by convention, no real value). The Tunisian dinar does not circulate freely outside Tunisia: a real dinar token would need a licensed partner (bank or payment institution) and the central bank's approval. Without the token, settlement is a **scaled HBAR amount**.
- The **approver key is held by the server** in this demo and used only after an authorized operator approves with the PIN; in production it lives in the approver's own wallet (or a multi-party signing service).
- A Hedera schedule expires (about 30 minutes by default); if the human answers later, Kanawita locks a new one and the approver co-signs that one.
- Operator authentication is a **demo PIN**, not a production identity system (no SSO / per-user credentials / RBAC).
- Single SQLite database; per-mission payment locking is in-process (one API instance).
- The simulated ledger and vault (no credentials) are local stand-ins, not a consensus network — on testnet they are real.
- Polling (0.8–3 s, ETag-revalidated) rather than server push.
- No real NGO or company users, pilots or partnerships are claimed.

## Project tree

```
el-joker-2/
├─ apps/
│  ├─ api/                 Express + TypeScript API
│  │  ├─ src/agents/       lem3alem, lemhaf, nasnes, kanawita (agents account + vault), marketplace, context,
│  │  │                    guardian/{policy.json, policy.acme.json, policy.ts (registry), engine.ts}
│  │  ├─ src/audit/        proofService (hash chain, anchoring, verification + completeness, demo tamper)
│  │  ├─ src/hedera/       sdkGateway (testnet: HCS, transfers, HTS, schedules), mirror, simulatedGateway
│  │  ├─ src/ai/           Anthropic client (structured outputs) + stub
│  │  ├─ src/orchestrator/ missionService (pipeline, organizations, vault lock, approvals, PIN, replay, verification, public bundle)
│  │  ├─ src/db/           SQLite store
│  │  ├─ src/scripts/      demoCheck, hederaSetup (topic, vault, stablecoin), seed
│  │  └─ test/             108 tests + opt-in testnet tests
│  └─ web/                 Next.js app: landing, chat, dashboard, audit trail, proof & verify, /verify (public verifier)
│     ├─ lib/              api client, useMissionControl hook, status, motion
│     └─ e2e/              Playwright browser tests
├─ packages/shared/        Zod domain models, API contracts, canonical JSON + the browser-safe bundle verifier
├─ docs/                   ARCHITECTURE.md, DEMO.md, pitch/, handoff/
├─ .env.example
└─ PROJECT_STATUS.md
```

## Live on Hedera testnet

- Proof topic: [`0.0.11007004`](https://hashscan.io/testnet/topic/0.0.11007004) — every decision of every mission is anchored there.
- 2-of-2 vault: [`0.0.11090535`](https://hashscan.io/testnet/account/0.0.11090535) · EJTND demo dinar token: [`0.0.11090536`](https://hashscan.io/testnet/token/0.0.11090536) · demo supplier: [`0.0.11090539`](https://hashscan.io/testnet/account/0.0.11090539).
- Verified 2026-10-19: `npm run demo:check` 11/11 on testnet with real Claude (`claude-opus-5-5`): the 9 scenarios A–I, deleted-event detection and the independent public verifier, vault and EJTND included.
- Example payment (scenario A, 12,450 EJTND): [HashScan](https://hashscan.io/testnet/transaction/1792450276.030571723) · example vault schedule, executed after the human co-signature (scenario E): [HashScan](https://hashscan.io/testnet/schedule/0.0.11090802).
- Earlier run (2026-10-12, before the switch to dinars): `npm run test:testnet` 2/2, `demo:check` 8/8, payment of 1.0375 HBAR: [HashScan](https://hashscan.io/testnet/transaction/0.0.10569347-1791831141-287680039).

## License

Code: [MIT](LICENSE) © 2026 Chain619. The agent mascot artwork belongs to Chain619. The Hedera logo is a trademark of its owner, shown only to indicate the integration.

## Troubleshooting

| Symptom | Fix |
|---|---|
| “API not reachable on :4000” | Start `npm run dev` (or `npm run demo`) from the repo root; the first dev start can take ~1 min |
| Header shows *Hedera · simulated* | `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` **and** `HEDERA_TOPIC_ID` must all be set, and `LEDGER_MODE` must not be `simulated`; restart |
| No *Vault 2-of-2* chip | Run `npm run hedera:setup -- --vault` (needs both `HEDERA_VAULT_ACCOUNT_ID` and `HEDERA_APPROVER_PRIVATE_KEY`); restart |
| `hedera:setup` fails with `DEADLINE_EXCEEDED` | Your network blocks gRPC to Hedera nodes (port 50211) — run it from another network/terminal |
| Payment refused: “HEDERA_PAYEE_ACCOUNT_ID is not configured” | `npm run hedera:setup -- --stablecoin` (or `--payee`), or set an existing testnet account |
| Payment failed `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` | The payee must accept EJTND: use the payee created by `--stablecoin` |
| Vault payment failed `INSUFFICIENT_TOKEN_BALANCE` | Run `npm run hedera:setup -- --stablecoin` again to move 1,000,000 EJTND into the vault |
| “Invalid operator PIN” / “Too many wrong PINs” | Demo PIN is `0619` unless `DEMO_OPERATOR_PIN` is set; lockout lasts 60 s |
| Verification shows PENDING | Mirror Node indexing lag (a few seconds) — press Verify again |
| Lemhaf shows FALLBACK “authentication failed” | Wrong `ANTHROPIC_API_KEY` |
| Animation stutters on the projector | Click **Motion: off** in the top bar |
| Want a clean demo | `npm run seed` |
