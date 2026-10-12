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

**Demo scenarios.** A approved ($5,000 Gabès) · B budget block ($100) · C duplicate payment attack ·
D unverified-but-cheap supplier rejected · E high-value mission → human review → approve/reject (operator + PIN) ·
F local tampering (edited evidence, recomputed hash chain, deleted event) detected against the Hedera proof ·
G recycled invoice from a verified supplier rejected (added after the code review).

## 2. Key decisions

| Decision | Reason |
|---|---|
| New repo `C:\Projects\el-joker-2`, nothing reused from old TrustMesh code | Handoff requires a clean build |
| npm workspaces: `packages/shared` (Zod domain), `apps/api` (Express), `apps/web` (Next.js) | Clear web/api split, shared typed models |
| SQLite via built-in `node:sqlite` | Persistent, zero native build step on Windows |
| Polling (0.8–3 s, ETag-revalidated, payloads only on demand) instead of WebSockets | Simplest reliable live updates for a demo |
| No smart contract | HCS + HBAR transfer + Mirror verification already cover proof & settlement; policy must stay deterministic off-chain code that judges can read. A contract would add risk without solving a stated requirement |
| Simulated ledger adapter when Hedera credentials are missing | Lets everything run; labeled SIMULATED, never shows fake tx ids or HashScan links |
| Nasnes is deterministic (mode `DETERMINISTIC`) | Verification must be independent from the AI it checks |
| Scaled demo settlement proportional to the authorized offer (0.25 ℏ per $1,000, cap 10 ℏ) | Paid amount stays tied to what 3ASES authorized; shown explicitly in UI and proof |
| Demo operator PIN (server-side, lockout) | Approvals cannot be forged by sending an operator name; still labeled as demo auth |
| Verification lists the topic (completeness) | Detects deleted events and altered anchor metadata, not only edited evidence |

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
| 8 | Demo scenarios | ✅ `npm run demo:check` 8/8 (A–G + deleted-event check; simulated ledger, fallback AI) |
| 9 | Tests + hardening | ✅ 90/90 API tests + 5/5 browser E2E (Playwright/Edge) |
| 10 | UX polish, README, architecture, demo script | ✅ |
| 11 | Code-review fixes (see §6) | ✅ |

## 4. Credentials / blocked real-integration steps

| Variable | Status (2026-10-05) |
|---|---|
| `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` | ✅ in local `.env` (copied from the old TrustMesh `.env` with the owner's approval; never printed) |
| `HEDERA_PAYEE_ACCOUNT_ID` | ✅ in local `.env` (old `SUPPLIER_ACCOUNT_ID`) |
| `HEDERA_TOPIC_ID` | ✅ `0.0.11007004` created by the owner with `npm run hedera:setup` (2026-10-12) |
| `ANTHROPIC_API_KEY` | ⛔ owner will add to `.env` |

Until `HEDERA_TOPIC_ID` is set the app stays in clearly labeled SIMULATED mode (live mode needs account + key + topic).

**Remaining live gates (run by the owner, then report output):**
1. `npm run hedera:setup` → add printed `HEDERA_TOPIC_ID=…` to `.env`
2. `npm run test:testnet` (2 live tests: approved + blocked, Mirror verification, tamper detection)
3. `npm run demo` then `npm run demo:check` → expect 8/8 with real tx ids / HashScan links
4. With `ANTHROPIC_API_KEY` set: header shows `AI: REAL`, LEMHAF chip `REAL AI · claude-opus-5-5`

## 5. Verification results (simulated ledger, no AI key)

- `npm run typecheck` — clean (shared, api, web)
- `npm test` — 90/90 passing (guardian 20, agents 19, proof 16, scenarios 15, HTTP API 6, hardening 14)
- `npm run test:e2e` — 5/5 passing in Microsoft Edge (landing→chat→A paid, D blocked, E wrong PIN refused then paid, F deletion detected, motion toggle)
- `npm run build` — API bundle + Next.js production build succeed
- `npm run demo:check` — 8/8 PASS against the running API
- Layout checked at 1600×1000, 1280×720 (projector), 1100×800 (dashboard stacks under chat) and 375×812 (no horizontal scroll)

### Live Hedera testnet (2026-10-12, run by the owner)

- `npm run test:testnet` — 2/2 passed (approved mission + blocked mission)
- Topic `0.0.11007004`: 11 proofs, verified independently on the Mirror Node (MISSION_CREATED → … → PAYMENT_CONFIRMED → TAMPER_DETECTED; second mission → GUARDIAN_BLOCKED)
- Payment `0.0.10569347@1791831141.287680039`: SUCCESS, 1.0375 HBAR to `0.0.10813331` (proportional to the $4,150 offer), memo `eljoker:<mission>:<idempotency prefix>`, fee 0.00111838 HBAR — HashScan link opens correctly

## 6. Code-review fixes (2026-10-05)

| # | Finding | Fix |
|---|---|---|
| 3 | Deleting the last event (or erasing anchor metadata) was not detected | Verification lists all topic messages for the mission, matches by eventId, reports deleted events and altered metadata; new tamper mode *Delete last event*; tests |
| 4 | Anyone could approve by sending an operator name | Server-side operator PIN (constant-time, 5-try lockout); approvals disabled outside demo mode without a configured PIN; PIN field in the UI; tests |
| 5 | Landing said “Five AI agents” (contradicts 3ASES/no-LLM) | “one AI researcher recommends, four rule-based agents verify, decide and pay” |
| 6 | Dev server instability on stage | `npm run demo` (production build + start) documented as the stage command |
| 7 | Heavy animated backdrop | Lighter blur; *Motion: off* toggle (no animation, no blur), remembered per browser |
| 8 | Dashboard hidden below 1280 px; cramped at 720 px height | Dashboard stacks under the chat; compact composer on short screens; scrollable tabs/chips |
| 9 | Paid amount unrelated to authorized amount | Settlement proportional to the offer (0.25 ℏ / $1,000, capped) |
| 10 | Full state polled every 0.8 s | Payloads only for the audit view; ETag/304 revalidation |
| 11 | Duplicate-invoice rule unreachable from the UI | Scenario G (verified supplier recycling an invoice from an earlier mission) |
| 12 | Dead code, 400-line component | `useMissionControl` hook + ConversationPanel / Dashboard / HistoryList / PipelineStrip; removed StatusBoard, Hero, big lineup, dead select |
| 13 | No frontend tests | Playwright E2E (5) using the installed Edge |
| 14 | Stale docs | README, DEMO, ARCHITECTURE, this file updated |
| 15 | Contrast, color-only status, emoji logo, USD only | Lighter text tokens, ✓/✕/! icons on chips, focus outline, aria labels, SVG logo, TND budgets (configurable demo rate) |
| 1 | Live Hedera never run | ✅ Done 2026-10-12: `test:testnet` 2/2 on testnet (see §5) |
| 2 | Real AI never run | **Still open — needs `ANTHROPIC_API_KEY`** |

## 7. Log

- 2026-10-05: Read handoff pack (master prompt, PDF, 3 diagrams, references). Created repo and plan.
- 2026-10-05: Backend (agents, guardian, proof layer, payments) + 15 E2E tests. Commit 24a4854.
- 2026-10-05: Next.js mission room, full test suite (76), demo-check, hedera:setup, testnet test. Fixed tsup stripping `node:` from `node:sqlite`. Commit ed48902.
- 2026-10-05: README, ARCHITECTURE, DEMO docs.
- 2026-10-05: `.env` created with Hedera account/key/payee. `hedera:setup` failed inside the Claude Code sandbox (gRPC DEADLINE_EXCEEDED; TCP 50211 blocked). Live testnet steps handed to the owner.
- 2026-10-05: UI redesigns (glass slabs, landing + ChatGPT-style chat, mascots, English-only agent messages).
- 2026-10-05: Code-review fixes §6: 90 API tests, 5 browser E2E, demo-check 8/8.
- 2026-10-12: Owner created topic 0.0.11007004; `test:testnet` 2/2 on Hedera testnet; payment and proofs confirmed on Mirror Node and HashScan. Fixed `--payee` argument forwarding in the root `hedera:setup` script.
- 2026-10-12: Live `demo:check` found a false TAMPERING_DETECTED on scenario A: the first HCS submit reached consensus (#12) but its receipt timed out, the retry published an identical copy (#13), and verification compared the local anchor with the first copy. Fix: verification picks the ledger copy the local anchor points at; HCS submit re-queries the receipt of the same transaction instead of republishing. Regression test added (91 tests).
