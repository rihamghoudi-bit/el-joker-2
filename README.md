# 🃏 EL JOKER 2.0 — 5ALIHA 3LINA

**Team Chain619 · Hedera Hackathon** · *“Autonomous, but never uncontrolled.”*

A verifiable AI-powered emergency procurement and autonomous-spending governance system.
An operator describes an urgent need (e.g. *500 people in Gabès need water and essential medicine, $5,000*). Five agents take it from there:

| Agent | Role | Property |
|---|---|---|
| 🎩 **LEM3ALEM** | Coordinator / planner | Turns the request into a validated mission; never invents critical facts |
| 🔍 **LEMHAF** | AI research | Claude ranks supplier offers and explains trade-offs — **recommends only** |
| 🕵️ **NASNES** | Independent verifier | Deterministic checks of registry, evidence, arithmetic and the AI’s own claims |
| 🛡️ **3ASES** | Guardian | Versioned deterministic policy + risk engine. **No LLM.** |
| 💰 **KANAWITA** | Payment executor | Re-checks authorization itself; cannot pay without it |

Every important decision is canonicalized, hashed (SHA-256), hash-linked to the previous one, and anchored to the **Hedera Consensus Service**. Payments are real **HBAR transfers on Hedera testnet** (scaled demo amount). The **Mirror Node** is used to independently verify that the local history still matches the consensus record — and to detect tampering.

> AI proposes → NASNES verifies → 3ASES decides → humans control high-risk actions → KANAWITA pays only when authorized → Hedera proves.

Architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Jury demo script: [docs/DEMO.md](docs/DEMO.md) · Status & decisions: [PROJECT_STATUS.md](PROJECT_STATUS.md)

---

## Quick start

Requirements: **Node.js ≥ 22.13** (developed on Node 24; uses the built-in `node:sqlite`), npm 10+.

```bash
npm install
cp .env.example .env      # then fill in values (see below) — optional for a first run
npm run dev               # API on http://localhost:4000, UI on http://localhost:3000
```

Without any credentials the app runs fully in a clearly labeled mode: **AI: FALLBACK ONLY** (rule-based ranking) and **HEDERA: SIMULATED** (local stand-in ledger, no transaction ids, no HashScan links). Nothing pretends to be real.

### Enable real Hedera testnet

1. Create a testnet account at <https://portal.hedera.com> and put `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` in `.env` (DER or hex; ECDSA and ED25519 are auto-detected against the Mirror Node).
2. Create the proof topic (and optionally a demo payee account):
   ```bash
   npm run hedera:setup -- --payee
   ```
   It prints `HEDERA_TOPIC_ID=…` and `HEDERA_PAYEE_ACCOUNT_ID=…` to add to `.env` (it never writes `.env` and never prints keys). The topic’s submit key is the operator key, so nobody else can post proofs to it.
3. Restart `npm run dev`. The header shows **HEDERA TESTNET · 0.0.x**.

`HEDERA_NETWORK` must be `testnet`; any other value refuses to start.

### Enable real AI

Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-opus-5-5`). The header shows **AI: REAL · model**; LEMHAF messages show `REAL AI · <model>`. If a call fails (timeout, rate limit, invalid output) LEMHAF falls back and says why.

---

## Commands

| Command | What |
|---|---|
| `npm run dev` | API (tsx watch) + UI (next dev) |
| `npm run build` | API bundle (`apps/api/dist`) + Next.js production build |
| `npm start` | Run the production builds |
| `npm run typecheck` | `tsc --noEmit` for shared, api, web |
| `npm test` | 76 unit/integration/E2E tests — in-memory DB + simulated ledger, **never spends funds** |
| `npm run test:testnet` | Opt-in live Hedera testnet tests (needs all `HEDERA_*` vars; spends a little testnet HBAR) |
| `npm run demo:check` | Runs all six jury scenarios against the running API and prints PASS/FAIL |
| `npm run hedera:setup` | Create HCS topic (`-- --payee` also creates a demo payee account) |
| `npm run seed` | Clear mission history and re-seed demo suppliers (demo mode only) |

## Environment variables

See [.env.example](.env.example). Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Real AI path (server-side only) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for LEM3ALEM/LEMHAF |
| `AI_ENABLED` | `true` | Force fallback when `false` |
| `HEDERA_NETWORK` | `testnet` | Must be `testnet` |
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | — | Testnet operator |
| `HEDERA_TOPIC_ID` | — | HCS proof topic |
| `HEDERA_PAYEE_ACCOUNT_ID` | — | Receives the demo settlement |
| `DEMO_SETTLEMENT_HBAR` | `1` | Scaled demo amount per paid mission |
| `AUTONOMOUS_PAYMENT_LIMIT` | `5000` | Above ⇒ human review |
| `MAX_TRANSACTION_LIMIT` | `25000` | Above ⇒ blocked |
| `HUMAN_APPROVAL_THRESHOLD` | `HIGH` | Risk level requiring a human |
| `DEMO_MODE` | `true` | Enables tamper simulation + reset; always off when `NODE_ENV=production` |
| `DEMO_OPERATORS` | `ops-lead,field-coordinator` | Demo operator ids allowed to approve |

## The six live scenarios

| | Scenario | Expected result |
|---|---|---|
| **A** | Approved — 500 people, Gabès, $5,000 | Verified supplier → APPROVED (risk LOW) → 1 ℏ paid on testnet → 6 proofs → PROOF VERIFIED |
| **B** | Budget block — same mission, $100 | 3ASES BLOCKED (budget) → no payment → `GUARDIAN_BLOCKED` on HCS |
| **C** | Duplicate payment attack | Replay → HTTP 409, “Mission is already PAID / idempotency key used” → `PAYMENT_BLOCKED` on HCS; still exactly one payment |
| **D** | Unverified supplier — 12-hour rush | LEMHAF picks the cheap express broker → NASNES REJECTED (not in registry, no license, implausible prices) → 3ASES BLOCKED |
| **E** | High-risk human review — 2,000 people, Médenine, $20,000 | $16,600 > $5,000 autonomous limit → HUMAN_REVIEW_REQUIRED → operator approves (or rejects) → paid (or not) |
| **F** | Tampering detection | Verify (VALID) → *Simulate local tampering* or *Insider rewrites hashes too* → Verify → **TAMPERING DETECTED** |

## Verifying on HashScan / Mirror Node yourself

1. In the UI, open **Audit timeline**: each event shows topic id, sequence number and a HashScan link to its HCS submit transaction.
2. Read the raw proof from the Mirror Node:
   `https://testnet.mirrornode.hedera.com/api/v1/topics/<TOPIC_ID>/messages/<SEQUENCE>` — `message` is base64; decode it to get `{"h": evidenceHash, "eh": eventHash, "ph": previousEventHash, …}`.
3. Expand “off-chain evidence” for that event, canonicalize it (sorted keys, no whitespace) and SHA-256 it — it must equal `h`.
4. Payment: the KANAWITA bubble and the status board link to the transfer on HashScan; Mirror Node: `/api/v1/transactions/<0.0.x-seconds-nanos>`.
5. Or just press **Verify against Hedera** in **Proof & verify** — it does steps 2–3 for every event.

## Security controls

- Secrets only in `.env` (git-ignored); `.env.example` has placeholders. The UI talks only to Next.js, which proxies `/api` — no keys in the browser. The logger redacts key-like values.
- Testnet only (hard check at startup; `Client.forTestnet()`).
- 3ASES is pure deterministic code (a test asserts it imports no AI/network modules).
- KANAWITA independently re-runs 3ASES and all payment preconditions; DB unique constraints make duplicate payments impossible; transfers are single-shot (no blind retries).
- Human approvals are bound to the Guardian input hash + policy version; unauthorized or stale approvals are ignored; one decision per mission.
- On-chain data is minimal: ids, hashes, event type, policy version, timestamp. No beneficiary data, no prices, no documents.
- Demo-only endpoints (tamper, reset) are disabled when `DEMO_MODE=false` or `NODE_ENV=production`.
- No chain-of-thought stored; AI runs keep only provider/model/mode/timestamp/input hash/summary.

## Honest limitations

- Suppliers, registry entries, reference prices and the marketplace are **fictional demo data**; there is no real supplier integration.
- Settlement is a **scaled demo amount** (default 1 HBAR), not the USD value of the offer; no FX or stablecoin.
- Operator identity is a **demo operator mode** (no production authentication / RBAC).
- Single-node SQLite; per-mission locking is in-process (fine for one API instance).
- The simulated ledger (no credentials) is a local stand-in, not a consensus network.
- No escrow or multi-signature release yet (Hedera Scheduled Transactions would be the next step).
- No real NGO users, pilots or partnerships are claimed.

## Project tree

```
el-joker-2/
├─ apps/
│  ├─ api/                 Express + TypeScript API
│  │  ├─ src/agents/       lem3alem, lemhaf, nasnes, kanawita, marketplace, guardian/{policy.json,policy.ts,engine.ts}
│  │  ├─ src/audit/        proofService (hash chain, anchoring, verification, demo tamper)
│  │  ├─ src/hedera/       sdkGateway (testnet), mirror, simulatedGateway
│  │  ├─ src/ai/           Anthropic client (structured outputs) + stub
│  │  ├─ src/orchestrator/ missionService (pipeline)
│  │  ├─ src/db/           SQLite store
│  │  ├─ src/scripts/      demoCheck, hederaSetup, seed
│  │  └─ test/             76 tests + opt-in testnet test
│  └─ web/                 Next.js mission room (chat, lineup, status board, approval, audit timeline, proof & verify)
├─ packages/shared/        Zod domain models + API contracts
├─ docs/                   ARCHITECTURE.md, DEMO.md, handoff/
├─ .env.example
└─ PROJECT_STATUS.md
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI says “API not reachable on :4000” | Start `npm run dev` from the repo root; check port 4000 is free |
| Header shows HEDERA: SIMULATED | `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` **and** `HEDERA_TOPIC_ID` must all be set; restart |
| Payment refused: “HEDERA_PAYEE_ACCOUNT_ID is not configured” | Run `npm run hedera:setup -- --payee` or set an existing testnet account |
| Log `hedera.operator_key_mismatch` | The key does not match the account on the Mirror Node — check you copied the right key |
| Verification shows PENDING | Mirror Node indexing lag (a few seconds) — press Verify again |
| LEMHAF shows FALLBACK with “authentication failed” | Wrong `ANTHROPIC_API_KEY` |
| `ExperimentalWarning: SQLite` | Harmless (built-in `node:sqlite`) |
| Want a clean demo | `npm run seed` (or “reset demo” in the UI) |
