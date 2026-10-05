# EL JOKER 2.0 — CLAUDE CODE MASTER BUILD PROMPT

You are the lead product architect, senior full-stack engineer, AI systems engineer,
Hedera engineer, security engineer, QA engineer and UX engineer for a hackathon product.

Your mission is to BUILD THE ENTIRE PROJECT FROM SCRATCH in this empty repository.

PROJECT:
EL JOKER — 5ALIHA 3LINA
Team: Chain619
Tagline: “Autonomous, but never uncontrolled.”

Do not reuse or depend on an old codebase. The attached handoff PDF and architecture images
are product requirements and design references only.

============================================================
1. PRODUCT THESIS
============================================================

Build a verifiable AI-powered emergency procurement and spending governance platform.

Primary scenario:
An NGO/emergency operator needs water and essential medicine for 500 people in Gabès
under a fixed budget. EL JOKER researches suppliers, verifies evidence, enforces policy,
requests human approval for high-risk actions, executes authorized testnet payment, and
creates independently verifiable Hedera proofs.

The product must demonstrate:
AI proposes.
Independent verification checks.
Deterministic policy decides.
Humans control high-risk actions.
Hedera proves what happened.
Payment executes only when authorized.

============================================================
2. FIVE AGENTS — PRESERVE THESE IDENTITIES
============================================================

LEM3ALEM — coordinator / mission planner.
LEMHAF — AI research / supplier discovery.
NASNES — independent verification / evidence checker.
3ASES — deterministic guardian / policy and risk engine. NO LLM.
KANAWITA — payment executor. It cannot bypass authorization.

============================================================
3. BUILD PRINCIPLES
============================================================

- Build from scratch with a clean, maintainable TypeScript architecture.
- Prefer a monorepo or clearly separated web/api packages.
- Suggested stack: Next.js + TypeScript frontend, Node/TypeScript backend, Zod validation,
  a simple persistent DB suitable for a hackathon (SQLite/Postgres abstraction), Hedera JS SDK.
- Use the current official Anthropic SDK for the AI path.
- Use Hedera TESTNET only.
- Never commit secrets.
- Never fabricate AI execution, blockchain transactions, users, partnerships or validation.
- Demo/sample data must be visibly labeled.
- Do not expose chain-of-thought. Store only concise model metadata and output summaries.
- Sensitive beneficiary/medical/personal data must remain off-chain.
- Do not add a token or smart contract merely for optics.
- Smart contracts are optional and only justified if they materially improve escrow,
  multi-party authorization, or settlement.
- Keep the product small enough to be reliable in a live hackathon demo.

============================================================
4. REQUIRED DOMAIN MODELS
============================================================

Mission:
missionId, description, location, beneficiaries, requestedItems, maximumBudget,
currency, deadline, urgency, constraints, createdAt, status.

Supplier:
supplierId, name, region, categories, verified, verificationSource, riskFlags.

Offer:
offerId, supplierId, missionId, items, totalPrice, currency, deliveryTime,
invoiceId/evidence identifiers, evidence, createdAt.

AgentRun:
runId, missionId, agent, mode (REAL_AI/FALLBACK/DEMO_DATA), status,
inputHash, outputSummary, model/provider when relevant, timestamp.

GuardianDecision:
decision (APPROVED/BLOCKED/HUMAN_REVIEW_REQUIRED), policyVersion,
checks[], reasons[], riskLevel, evaluatedAt.

Approval:
approvalId, missionId, actorId, decision, reason, timestamp, policyVersion.

AuditEvent:
schemaVersion, eventId, missionId, eventType, policyVersion,
evidenceHash, previousEventHash, timestamp, hederaTransactionId/consensusTimestamp when known.

Payment:
paymentId, missionId, idempotencyKey, amount, currency, status,
hederaTransactionId, createdAt, confirmedAt.

============================================================
5. LEM3ALEM
============================================================

Convert a natural-language request into a validated Mission.
Never invent missing critical facts. Return NEEDS_INFORMATION when required.
Create mission ID and persist it.
Emit MISSION_CREATED audit event.

============================================================
6. LEMHAF — REAL AI PATH
============================================================

Implement a real Anthropic API path when ANTHROPIC_API_KEY is configured.
Use structured output validation with Zod/JSON schema.
Use timeout and controlled retry.
Clearly show REAL_AI, FALLBACK or DEMO_DATA in the UI.
AI may rank offers, summarize evidence and explain trade-offs.
AI must never authorize payment.
Never expose hidden chain-of-thought.

============================================================
7. NASNES
============================================================

Independently verify the recommendation:
- supplier exists
- supplier verified
- allowed region
- required items present
- price arithmetic consistent
- evidence exists
- duplicate offer/invoice detection
- suspicious inconsistency detection
- unsupported AI claims

Return VERIFIED / REJECTED / NEEDS_REVIEW with structured reasons.

============================================================
8. 3ASES — DETERMINISTIC GUARDIAN
============================================================

No LLM. Same input + same policy version = same result.

Configurable policy checks:
- budget
- region
- verified supplier
- duplicate payment
- duplicate invoice
- price anomaly
- allowed spending category
- transaction/autonomous limit
- valid mission state
- Nasnes verification required
- human approval threshold

Risk levels:
LOW / MEDIUM / HIGH / CRITICAL.

Outputs:
APPROVED / BLOCKED / HUMAN_REVIEW_REQUIRED.

Policy must be centralized and versioned, not scattered across controllers.

============================================================
9. HUMAN-IN-THE-LOOP
============================================================

High-risk actions stop before payment.
UI shows mission, supplier, amount, Guardian checks, risk flags, AI recommendation,
Nasnes result and Hedera proof status.
Authorized operator can APPROVE or REJECT with reason.
If authentication is not production-grade, implement a clearly labeled demo operator mode.
Emergency override, if implemented, must require an authorized actor + reason and create
an immutable audit event. It must never silently bypass policy.

============================================================
10. HEDERA PROOF LAYER
============================================================

Use Hedera Consensus Service for meaningful proof events.
At minimum:
MISSION_CREATED
AI_RECOMMENDATION
SUPPLIER_VERIFIED
GUARDIAN_APPROVED
GUARDIAN_BLOCKED
HUMAN_REVIEW_REQUIRED
HUMAN_APPROVED
HUMAN_REJECTED
PAYMENT_INITIATED
PAYMENT_CONFIRMED
PAYMENT_FAILED
TAMPER_DETECTED (when appropriate)

Store only minimal proof metadata/hashes on-chain.
Build a canonical payload and SHA-256 evidence hashing.
Link mission events with previousEventHash to form a tamper-evident chain.

Implement HederaProofService:
recordEvent()
getProof()
verifyProof()
verifyMissionTrail()

Use Hedera Mirror Node to independently verify HCS messages/transactions where possible.
Expose HashScan links for real testnet records.

============================================================
11. PAYMENT SAFETY
============================================================

KANAWITA must check:
- Guardian permits execution
- required human approvals exist
- Nasnes result is VERIFIED
- mission is not already paid
- idempotency key is unused

Flow:
AUTHORIZED
→ PAYMENT_INITIATED proof
→ Hedera testnet transfer (scaled demo amount if needed)
→ receipt/verification
→ PAYMENT_CONFIRMED proof

Failure:
PAYMENT_FAILED proof.

Never mark paid before confirmation.
Never use mainnet.

============================================================
12. SIX REQUIRED LIVE DEMOS
============================================================

A. APPROVED
500 people, water + medicine, Gabès, $5,000.
Verified supplier, valid offer.
APPROVED → testnet payment → Hedera proofs.

B. BUDGET BLOCK
Same mission with $100.
BLOCKED → 0 payment → block proof.

C. DUPLICATE PAYMENT ATTACK
First authorized payment succeeds.
Second attempt is blocked by idempotency/duplicate protection.

D. UNVERIFIED SUPPLIER
AI finds an attractive cheap supplier.
Nasnes/3ASES reject it.
This proves AI cannot bypass policy.

E. HIGH-RISK HUMAN REVIEW
Transaction exceeds autonomous threshold.
HUMAN_REVIEW_REQUIRED.
No payment until operator approves.

F. AUDIT TAMPERING
Development/demo-only action changes local historical evidence.
Verifier recomputes hashes and reports INVALID / TAMPERING DETECTED against Hedera proof.

============================================================
13. UX
============================================================

Preserve EL JOKER's Tunisian personality and the five named characters.
Do not build a generic finance dashboard.

Main experience:
- mission composer
- group-chat style agent activity
- current agent
- mission/budget/region
- supplier and offer
- risk level
- Guardian decision
- human approval
- payment status
- Hedera proof status
- audit timeline

Status chips:
AI ANALYZING / VERIFIED / APPROVED / BLOCKED / HUMAN REVIEW / PAID / PROOF VERIFIED.

Create a strong audit timeline with event, time, agent, explanation, proof status,
transaction/topic reference and HashScan link.

Create a “Why Hedera?” verification view:
LOCAL RECORD vs HEDERA PROOF vs VERIFICATION RESULT.
Demo-only tamper button must never be enabled in production mode.

============================================================
14. BUSINESS POSITIONING
============================================================

Target users:
NGOs, humanitarian organizations, emergency-response programs,
grant/disbursement programs.

Value proposition:
Fast AI-assisted procurement without uncontrolled autonomous spending.

Potential business model:
B2B SaaS / organization subscription / usage-based proof volume / enterprise deployment.

Do not invent customers, pilots or partnerships.

============================================================
15. TESTING
============================================================

Write unit + integration + end-to-end tests for:
mission validation
AI schema/fallback
supplier verification
budget approve/reject
region reject
unverified supplier
duplicate invoice
duplicate payment
price anomaly
human review
human approve/reject
Hedera payload generation
hashing
audit chain
tamper detection
payment authorization
idempotency
payment failure
Mirror Node error handling
approved E2E
blocked E2E

Tests must never spend real funds.
Real Hedera integration tests use testnet only and should be separable from normal CI.

============================================================
16. DEV EXPERIENCE
============================================================

Provide:
README.md
.env.example
seed/demo data
one-command local startup if feasible
one-command test
one-command demo or clear demo commands
Mermaid architecture diagram
troubleshooting section

Environment should include equivalents of:
HEDERA_NETWORK=testnet
HEDERA_ACCOUNT_ID=
HEDERA_PRIVATE_KEY=
HEDERA_TOPIC_ID=
ANTHROPIC_API_KEY=
AI_ENABLED=true
DEMO_MODE=true
AUTONOMOUS_PAYMENT_LIMIT=
HUMAN_APPROVAL_THRESHOLD=

Never overwrite .env or print secrets.

============================================================
17. IMPLEMENTATION ORDER
============================================================

Do not only give a plan. Build the project.

Phase 1: scaffold + domain models + DB + UI shell.
Phase 2: mission orchestration + demo supplier data.
Phase 3: Lemhaf AI + Nasnes verification.
Phase 4: deterministic 3ASES policy/risk engine.
Phase 5: approval workflow.
Phase 6: Hedera HCS proof layer + Mirror verification.
Phase 7: safe testnet payment.
Phase 8: six demo scenarios.
Phase 9: automated tests and hardening.
Phase 10: UX polish + README + demo script.

At the end of every phase:
- run typecheck
- run relevant tests
- fix failures before continuing

============================================================
18. QUALITY GATE
============================================================

Do not claim completion until:
frontend starts
backend starts
approved scenario works
blocked scenario works
duplicate payment is blocked
unverified supplier is blocked
human review works
real AI path works when key exists
fallback is clearly labeled
3ASES contains no LLM
HCS proofs work on testnet
Mirror verification works
testnet payment works
HashScan links work
audit chain verifies
tampering is detected
secrets are not committed
tests pass
README matches reality
UI contains no false claims

============================================================
19. FINAL REPORT
============================================================

When finished, report:
architecture created
files/modules created
features implemented
Hedera IDs created/required
AI setup
tests and exact results
commands to run
commands to demo
required environment variables
known honest limitations
recommended 3-minute and 5-minute jury demo sequences

IMPORTANT:
You are building a hackathon project, not a slide deck.
Prioritize reliability, proof and live-demo clarity over feature count.
Do not stop at scaffolding.
Do not fabricate success.
If an external credential is missing, build everything else, provide a mock adapter,
and clearly identify the exact final step requiring the credential.

Final product thesis:
“AI proposes. Verification checks. Deterministic policy decides.
Humans control high-risk actions. Hedera proves. Payment executes only when authorized.”