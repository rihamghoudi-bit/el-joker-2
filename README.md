# EL JOKER 2.0 — 5ALIHA 3LINA

**Team Chain619 · Hedera Hackathon** · *“Autonomous, but never uncontrolled.”*

A verifiable, AI-assisted emergency procurement and autonomous-spending governance system.
An operator sends a request in a chat (e.g. *500 people in Gabès need drinking water and essential medicine, budget $5,000*). Five agents take it from there — **one AI researcher recommends, four rule-based agents verify, decide and pay**:

| Agent | Role | Property |
|---|---|---|
| **LEM3ALEM** | Coordinator / planner | Turns the request into a validated mission; never invents critical facts |
| **LEMHAF** | AI research (Claude) | Ranks supplier offers and explains trade-offs — **recommends only** |
| **NASNES** | Independent verifier | Deterministic checks of registry, evidence, arithmetic, invoices and the AI's own claims |
| **3ASES** | Guardian | Versioned deterministic policy + risk engine. **No LLM.** |
| **KANAWITA** | Payment executor | Re-checks authorization itself; cannot pay without it |

Every important decision is canonicalized, hashed (SHA-256), hash-linked to the previous one and anchored to the **Hedera Consensus Service**. Payments are **HBAR transfers on Hedera testnet** (scaled demo amount, proportional to the authorized offer). Verification reads the **Mirror Node** independently: it detects edited evidence, a recomputed local hash chain, altered anchor metadata **and deleted events**.

> AI proposes → NASNES verifies → 3ASES decides → humans control high-risk actions → KANAWITA pays only when authorized → Hedera proves.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Jury demo script: [docs/DEMO.md](docs/DEMO.md) · Status & decisions: [PROJECT_STATUS.md](PROJECT_STATUS.md)

---

## Quick start

Requirements: **Node.js ≥ 22.13** (developed on Node 24; uses the built-in `node:sqlite`), npm 10+.

```bash
npm install
cp .env.example .env      # fill in values (see below) — optional for a first run
npm run dev               # API http://localhost:4000 · UI http://localhost:3000
```

Without credentials everything runs in a clearly labeled mode: **AI · fallback** (rule-based ranking) and **Hedera · simulated** (local stand-in ledger: no transaction ids, no HashScan links). Nothing pretends to be real.

**For a live demo use the production build** (faster start, no hot-reload surprises):

```bash
npm run demo              # = npm run build && npm start
```

### Enable real Hedera testnet

1. Create a testnet account at <https://portal.hedera.com>; put `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` in `.env` (DER or hex; ECDSA/ED25519 auto-detected against the Mirror Node).
2. Create the proof topic (and optionally a demo payee account) — **run this from your own terminal** (it needs gRPC access to Hedera nodes, port 50211):
   ```bash
   npm run hedera:setup -- --payee
   ```
   It prints `HEDERA_TOPIC_ID=…` (and `HEDERA_PAYEE_ACCOUNT_ID=…`) to add to `.env`. It never writes `.env` and never prints keys. The topic's submit key is the operator key, so nobody else can post proofs to it.
3. Restart. The header shows **Hedera testnet · 0.0.x**.

`HEDERA_NETWORK` must be `testnet`; any other value refuses to start.

### Enable real AI

Set `ANTHROPIC_API_KEY` (optionally `ANTHROPIC_MODEL`, default `claude-opus-5-5`). The header shows **AI · model**; Lemhaf's messages show `REAL AI · <model>`. If a call fails (timeout, rate limit, refusal, invalid output) Lemhaf falls back and says why.

---

## Using the app

1. **Landing** → *Go for EL JOKER*.
2. **Chat**: a ready-made request is already in the message box — press send (↑ or Enter). Chips **A–G** swap in another scenario's request; edited text is sent as a free-text mission (USD or TND budgets).
3. Watch the agents talk; the right panel shows the key numbers, **Live Hedera proofs** and actions (*Verify against Hedera*, *Replay payment (attack)*).
4. **Human review** (scenario E): an approval card appears in the conversation — choose an operator, give a reason and enter the **operator PIN** (demo default **`0619`**, override with `DEMO_OPERATOR_PIN`).
5. **Proof & verify** tab: *Verify against Hedera* → then *Simulate local tampering*, *Insider rewrites hashes too* or *Delete last event* → *Verify* again.
6. **Motion: on/off** (top bar) turns the animated backdrop and blur off for projectors / low-end laptops.

## The live scenarios

| | Scenario | Expected result |
|---|---|---|
| **A** | Approved — 500 people, Gabès, $5,000 | Verified supplier → APPROVED (risk LOW) → 1.0375 ℏ paid on testnet → 6 proofs → PROOF VERIFIED |
| **B** | Budget block — same mission, $100 | 3ASES BLOCKED (budget) → no payment → `GUARDIAN_BLOCKED` on HCS |
| **C** | Duplicate payment attack | Replay → HTTP 409 (“Mission is already PAID / idempotency key used”) → `PAYMENT_BLOCKED` on HCS; still exactly one payment |
| **D** | Unverified supplier — 12-hour rush | Lemhaf picks the cheap express broker → NASNES REJECTED (not in registry, no license, implausible prices) → BLOCKED |
| **E** | High-risk human review — 2,000 people, Médenine, $20,000 | $16,600 > $5,000 autonomous limit → HUMAN_REVIEW_REQUIRED → operator + PIN approves (or rejects) → 4.15 ℏ paid (or nothing) |
| **F** | Tampering detection | Verify (VALID) → edit evidence / rewrite the local hash chain / delete the last event → Verify → **TAMPERING DETECTED** |
| **G** | Recycled invoice — Kairouan, $4,500 | A *verified*, cheaper supplier reuses invoice `INV-KQS-2026-0042` already used by an earlier mission → NASNES REJECTED → BLOCKED |

## Commands

| Command | What |
|---|---|
| `npm run dev` | API (tsx watch) + UI (next dev) |
| `npm run demo` | Production build + start (recommended on stage) |
| `npm run build` / `npm start` | API bundle + Next.js production build / run them |
| `npm run typecheck` | `tsc --noEmit` for shared, api, web |
| `npm test` | 90 unit / integration / scenario tests — in-memory DB + simulated ledger, **never spends funds** |
| `npm run test:e2e` | 5 browser tests (Playwright, uses the installed Microsoft Edge) against the running app |
| `npm run test:testnet` | Opt-in live Hedera testnet tests (needs all `HEDERA_*`; spends a little testnet HBAR) |
| `npm run demo:check` | Runs every scenario (A–G + deleted-event check) against the running API and prints PASS/FAIL |
| `npm run hedera:setup` | Create the HCS topic (`-- --payee` also creates a demo payee account) |
| `npm run seed` | Clear mission history and re-seed demo data (demo mode only) |

## Environment variables

See [.env.example](.env.example). Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Real AI path (server-side only) |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for Lem3alem (free text) and Lemhaf |
| `AI_ENABLED` | `true` | Force fallback when `false` |
| `HEDERA_NETWORK` | `testnet` | Must be `testnet` |
| `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` | — | Testnet operator |
| `HEDERA_TOPIC_ID` | — | HCS proof topic |
| `HEDERA_PAYEE_ACCOUNT_ID` | — | Receives the demo settlement |
| `DEMO_SETTLEMENT_HBAR_PER_1000_USD` / `DEMO_SETTLEMENT_MAX_HBAR` | `0.25` / `10` | Settlement = offer USD / 1000 × rate, capped |
| `AUTONOMOUS_PAYMENT_LIMIT` | `5000` | Above ⇒ human review |
| `MAX_TRANSACTION_LIMIT` | `25000` | Above ⇒ blocked |
| `HUMAN_APPROVAL_THRESHOLD` | `HIGH` | Risk level requiring a human |
| `DEMO_OPERATORS` | `ops-lead,field-coordinator` | Operators allowed to approve |
| `DEMO_OPERATOR_PIN` | — (demo: `0619`) | PIN for approvals; required when `DEMO_MODE=false` |
| `TND_PER_USD` | `3.1` | Demo conversion for budgets written in dinars |
| `DEMO_MODE` | `true` | Enables tamper simulation + reset; always off when `NODE_ENV=production` |

## Verifying on HashScan / Mirror Node yourself

1. **Audit trail** tab: each event shows topic id, sequence number and a HashScan link to its HCS submit transaction.
2. Raw proof: `https://testnet.mirrornode.hedera.com/api/v1/topics/<TOPIC_ID>/messages/<SEQUENCE>` — `message` is base64; decoding gives `{"e": eventId, "h": evidenceHash, "eh": eventHash, "ph": previousEventHash, "m": missionId, …}`.
3. Expand “off-chain evidence” for that event, canonicalize it (sorted keys, no whitespace) and SHA-256 it — it must equal `h`.
4. Payment: the Kanawita message and the Payment card link to the transfer on HashScan; Mirror Node: `/api/v1/transactions/<0.0.x-seconds-nanos>`.
5. Or press **Verify against Hedera**: it lists *all* of the mission's proofs on the topic, matches them to local events by `eventId`, recomputes every hash, checks the chain links — and reports any proof whose local event was deleted.

## Security controls

- **Secrets** only in `.env` (git-ignored); `.env.example` has placeholders. The browser only talks to Next.js, which proxies `/api` — no keys client-side. The logger redacts key-like values.
- **Testnet only** (hard check at startup; `Client.forTestnet()`).
- **3ASES** is a pure deterministic function (a test asserts it imports no AI/network modules and uses no clock/randomness).
- **KANAWITA** independently re-runs 3ASES and all payment preconditions, and waits for the authorization proof to be anchored; DB unique constraints make duplicate payments impossible; transfers are single-shot (no blind retries).
- **Human approvals**: authorized operator + server-checked PIN (constant-time compare, lockout after 5 failures), bound to the Guardian input hash and policy version; stale or unauthorized approvals are ignored; one decision per mission.
- **Tamper evidence**: edited evidence, recomputed local hash chains, altered anchor metadata and deleted events are all detected against the ledger.
- **On-chain data is minimal**: ids, hashes, event type, policy version, timestamp. No beneficiary data, prices or documents.
- **Demo-only endpoints** (tamper, reset) are disabled when `DEMO_MODE=false` or `NODE_ENV=production`.
- **AI hygiene**: structured output validated twice; registry status deliberately hidden from the AI; no chain-of-thought stored (provider, model, mode, input hash, summary only).

## Honest limitations

- Suppliers, registry entries, reference prices, the marketplace and the earlier "history" invoice are **fictional demo data**.
- Settlement is a **scaled demo amount** in HBAR (proportional to the authorized USD offer), not the USD value; no FX or stablecoin.
- Operator authentication is a **demo PIN**, not a production identity system (no SSO / per-user credentials / RBAC).
- Single SQLite database; per-mission payment locking is in-process (one API instance).
- The simulated ledger (no credentials) is a local stand-in, not a consensus network — the tamper demo is only meaningful against it for illustration; on testnet it is real.
- Polling (0.8–3 s, ETag-revalidated) rather than server push.
- No escrow / multi-signature release yet (Hedera Scheduled Transactions would be the next step).
- No real NGO users, pilots or partnerships are claimed.

## Project tree

```
el-joker-2/
├─ apps/
│  ├─ api/                 Express + TypeScript API
│  │  ├─ src/agents/       lem3alem, lemhaf, nasnes, kanawita, marketplace, context, guardian/{policy.json,policy.ts,engine.ts}
│  │  ├─ src/audit/        proofService (hash chain, anchoring, verification + completeness, demo tamper)
│  │  ├─ src/hedera/       sdkGateway (testnet), mirror, simulatedGateway
│  │  ├─ src/ai/           Anthropic client (structured outputs) + stub
│  │  ├─ src/orchestrator/ missionService (pipeline, approvals, PIN, replay, verification)
│  │  ├─ src/db/           SQLite store
│  │  ├─ src/scripts/      demoCheck, hederaSetup, seed
│  │  └─ test/             90 tests + opt-in testnet test
│  └─ web/                 Next.js app: landing, chat (conversation, pipeline, approval), dashboard, audit trail, proof & verify
│     ├─ lib/              api client, useMissionControl hook, status, motion
│     └─ e2e/              Playwright browser tests
├─ packages/shared/        Zod domain models + API contracts
├─ docs/                   ARCHITECTURE.md, DEMO.md, handoff/
├─ .env.example
└─ PROJECT_STATUS.md
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| “API not reachable on :4000” | Start `npm run dev` (or `npm run demo`) from the repo root; the first dev start can take ~1 min |
| Header shows *Hedera · simulated* | `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` **and** `HEDERA_TOPIC_ID` must all be set; restart |
| `hedera:setup` fails with `DEADLINE_EXCEEDED` | Your network blocks gRPC to Hedera nodes (port 50211) — run it from another network/terminal |
| Payment refused: “HEDERA_PAYEE_ACCOUNT_ID is not configured” | `npm run hedera:setup -- --payee`, or set an existing testnet account |
| “Invalid operator PIN” / “Too many wrong PINs” | Demo PIN is `0619` unless `DEMO_OPERATOR_PIN` is set; lockout lasts 60 s |
| Verification shows PENDING | Mirror Node indexing lag (a few seconds) — press Verify again |
| Lemhaf shows FALLBACK “authentication failed” | Wrong `ANTHROPIC_API_KEY` |
| Animation stutters on the projector | Click **Motion: off** in the top bar |
| Want a clean demo | `npm run seed` |
