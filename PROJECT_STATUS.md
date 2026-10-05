# EL JOKER 2.0 — 5ALIHA 3LINA · Project Status

Team Chain619 · "Autonomous, but never uncontrolled."

_Last updated: 2026-10-05_

---

## 1. Understanding of the specification

**Product.** A verifiable, AI-assisted emergency procurement and autonomous-spending governance system.
An operator (NGO / emergency program) describes an urgent need. AI researches and ranks supplier offers,
an independent verifier checks the evidence, a deterministic Guardian applies versioned policy, humans
decide high-risk cases, a payment agent executes only authorized testnet payments, and Hedera provides
public, tamper-evident proof of every important decision. The thesis is *safe autonomous spending with
independent proof*, not "five chatbots".

**The five agents.**
| Agent | Role | Hard property |
|---|---|---|
| LEM3ALEM | Coordinator: turns the request into a validated `Mission`, drives the pipeline | Never invents critical facts → `NEEDS_INFORMATION` |
| LEMHAF | Research: gathers candidate offers, AI ranks/summarizes them | May recommend; never authorizes money |
| NASNES | Independent verifier: registry, region, items, arithmetic, evidence, duplicates, unsupported AI claims | Deterministic code, independent from the AI |
| 3ASES | Guardian: versioned deterministic policy + risk engine | **No LLM.** Same input + same policy = same decision |
| KANAWITA | Payment executor | Re-checks authorization itself; physically cannot pay without it |

**Security model.** AI output is treated as untrusted *input*. Authorization comes only from deterministic
code (3ASES) plus, where required, an explicit human approval. KANAWITA re-evaluates the Guardian against
fresh database state immediately before paying, requires a VERIFIED Nasnes result, a valid approval when the
decision needed one, an unused idempotency key and an unpaid mission. Database unique constraints back the
idempotency rule so even a code bug cannot create a second payment. Secrets live only in `.env`; testnet only.

**Role of AI.** Claude (Anthropic API, model from `ANTHROPIC_MODEL`) ranks offers and explains trade-offs
(LEMHAF) and parses free-text requests (LEM3ALEM). Structured output is validated with Zod. Timeouts and a
controlled retry are applied; failure falls back to a rule-based path that is *labeled FALLBACK*. No
chain-of-thought is stored — only provider/model, mode, timestamp, input hash and a short output summary.

**Deterministic Guardian.** Central versioned `policy.json` (+ env overrides folded into the policy hash).
Checks: mission state, Nasnes verification, verified supplier, region, category, currency, budget, price
anomaly, duplicate invoice, duplicate payment, autonomous limit, maximum transaction, risk-based human
approval threshold. Output: `APPROVED | BLOCKED | HUMAN_REVIEW_REQUIRED` with `LOW..CRITICAL` risk.

**Human approval.** Decisions requiring review stop the mission in `HUMAN_REVIEW`. A demo operator (clearly
labeled — no production auth) approves or rejects with a reason. An approval is bound to the exact Guardian
input hash and policy version; the Guardian then re-runs with the approval and only then may KANAWITA pay.

**Role of Hedera.** HCS topic messages carry minimal proof records (event type, ids, evidence hash, previous
event hash, policy version). Mirror Node is used to independently read them back. Local DB history can be
edited; the consensus record cannot — the verifier compares the two.

**Payment flow.** AUTHORIZED → `PAYMENT_INITIATED` proof → `TransferTransaction` (scaled demo amount, e.g.
1 HBAR, testnet) → receipt SUCCESS → `PAYMENT_CONFIRMED` proof (→ Mirror confirmation). Failure →
`PAYMENT_FAILED` proof. Never marked paid before the receipt.

**Audit/proof system.** Canonical JSON (sorted keys) → SHA-256 `evidenceHash`; each event also stores
`previousEventHash` (hash-linked per mission) and its own `eventHash`. `verifyMissionTrail()` recomputes all
hashes, checks links, and compares with the HCS message fetched from the Mirror Node → VALID /
TAMPERING DETECTED.

**Six demo scenarios.** A approved ($5,000 Gabès) · B budget block ($100) · C duplicate payment attack ·
D unverified-but-cheap supplier rejected · E high-value mission → human review → approve/reject ·
F local tampering detected against Hedera proof.

## 2. Key decisions

| Decision | Reason |
|---|---|
| New repo `C:\Projects\el-joker-2`, nothing reused from old TrustMesh code | Handoff requires a clean build |
| npm workspaces: `packages/shared` (Zod domain), `apps/api` (Express), `apps/web` (Next.js) | Clear web/api split, shared typed models |
| SQLite via built-in `node:sqlite` | Persistent, zero native build step on Windows |
| Polling (≈1 s) instead of WebSockets | Simplest reliable live updates for a demo |
| No smart contract | HCS + HBAR transfer + Mirror verification already cover proof & settlement; policy must stay deterministic off-chain code that judges can read. A contract would add risk without solving a stated requirement |
| Simulated ledger adapter when Hedera credentials are missing | Lets everything run; labeled SIMULATED, never shows fake tx ids or HashScan links |
| Nasnes is deterministic (mode `DETERMINISTIC`) | Verification must be independent from the AI it checks |
| Scaled demo settlement (default 1 HBAR) | Shown explicitly in UI and proof |

## 3. Implementation plan

| Phase | Scope | Status |
|---|---|---|
| 1 | Scaffold, domain models (Zod), DB, UI shell | ✅ |
| 2 | LEM3ALEM + orchestration + demo supplier data | ✅ |
| 3 | LEMHAF real AI/fallback + NASNES | ✅ (real AI path implemented + stub-tested; live call blocked on key) |
| 4 | 3ASES policy + risk engine | ✅ |
| 5 | Human approval workflow | ✅ |
| 6 | HCS proof layer, canonical hashing, audit chain, Mirror verification | ✅ (simulated ledger verified; live testnet blocked on credentials) |
| 7 | KANAWITA safe testnet payment + idempotency | ✅ (simulated; live testnet blocked on credentials) |
| 8 | Six demo scenarios | ✅ `npm run demo:check` 6/6 (simulated ledger, fallback AI) |
| 9 | Tests + hardening | ✅ 76/76 tests |
| 10 | UX polish, README, architecture, demo script | ✅ |

## 4. Credentials / blocked real-integration steps

| Variable | Status (2026-10-05) |
|---|---|
| `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` | ✅ in local `.env` (copied from the old TrustMesh `.env` with the owner's approval; never printed) |
| `HEDERA_PAYEE_ACCOUNT_ID` | ✅ in local `.env` (old `SUPPLIER_ACCOUNT_ID`) |
| `HEDERA_TOPIC_ID` | ⛔ not yet created — `npm run hedera:setup` must run from a terminal with gRPC access to Hedera (port 50211). Claude Code's sandbox blocks raw TCP to consensus nodes (Mirror Node HTTPS works), so this step is for the owner to run |
| `ANTHROPIC_API_KEY` | ⛔ owner will add to `.env` |

Until `HEDERA_TOPIC_ID` is set the app stays in clearly labeled SIMULATED mode (live mode needs account + key + topic).

**Remaining live gates (run by the owner, then report output):**
1. `npm run hedera:setup` → add printed `HEDERA_TOPIC_ID=…` to `.env`
2. `npm run test:testnet` (2 live tests: approved + blocked, Mirror verification, tamper detection)
3. `npm run dev` then `npm run demo:check` → expect 6/6 with real tx ids / HashScan links
4. With `ANTHROPIC_API_KEY` set: header shows `AI: REAL`, LEMHAF chip `REAL AI · claude-opus-5-5`

## 5. Verification results (simulated ledger, no AI key)

- `npm run typecheck` — clean (shared, api, web)
- `npm test` — 76/76 passing (guardian 20, agents 19, proof 16, scenarios E2E 15, HTTP API 6)
- `npm run build` — API bundle + Next.js production build succeed; built API boots and runs scenario B
- `npm run demo:check` — 6/6 scenarios PASS against the running dev API
- UI checked in the browser: scenario A (PAID), E (approval card → approve → PAID), F (tamper → TAMPERING DETECTED), responsive layout

## 6. Log

- 2026-10-05: Read handoff pack (master prompt, PDF, 3 diagrams, references). Created repo and plan.
- 2026-10-05: Backend (agents, guardian, proof layer, payments) + 15 E2E tests. Commit 24a4854.
- 2026-10-05: Next.js mission room, full test suite (76), demo-check, hedera:setup, testnet test. Fixed tsup stripping `node:` from `node:sqlite`. Commit ed48902.
- 2026-10-05: README, ARCHITECTURE, DEMO docs.
- 2026-10-05: `.env` created with Hedera account/key/payee. `hedera:setup` failed inside the Claude Code sandbox (gRPC DEADLINE_EXCEEDED; TCP 50211 blocked). Live testnet steps handed to the owner.
