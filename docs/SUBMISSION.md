# 4Hacks submission — EL JOKER 2.0

Texts ready to paste into the Hedera Cross Campus Challenge 2026 submission form. The 4Hacks form is the source of truth for which fields exist; pick the matching block for each field.

## Project name

EL JOKER 2.0 — 5ALIHA 3LINA

## One-line description

The control layer for AI agents that spend money: one AI proposes, strict rules decide, a human co-signs on Hedera above the limit, and Hedera proves every step.

## Team

Chain619 — Rihem Ghoudi and Mariem Souayh.

## Problem

AI agents can now research, buy and pay on their own. For an organization this creates three risks: the agent invents things (a supplier, a price, an approval), it overspends or pays the same invoice twice, and its logs can be edited after the fact. Today an organization has to choose between autonomy (fast, but uncontrolled) and control (safe, but slow and manual). The risk is highest where money is scarce and accountability matters: an NGO buying water and medicine in an emergency must justify every dinar to its donors, and a company must keep procurement within its spending policy.

## Solution

EL JOKER splits an agent's purchase into five steps, each owned by a separate agent, and only one of them uses AI:

1. **Lem3alem** turns the request into a mission (who, where, what, budget).
2. **Lemhaf** (Claude) ranks the supplier offers and explains its choice. It can only recommend.
3. **Nasnes** independently checks the supplier, the evidence, the invoice and the AI's claims.
4. **3ases** applies the organization's spending policy with fixed rules and no AI: approve, block or ask a human.
5. **Kanawita** pays only with an approval proven on Hedera, and never twice.

Above the organization's autonomous limit, the money sits in a 2-of-2 Hedera vault: the agents can only lock the payment (1 signature of 2); only the human approver's signature makes Hedera release it. Every decision is fingerprinted on the Hedera Consensus Service, so anyone can check afterwards that nothing was changed or deleted.

The same engine serves any organization; only the policy file changes. The demo runs two: a relief NGO (15,000 TND autonomous limit) and a company, ACME (6,000 TND).

## How Hedera is used (and why)

Hedera is not a log next to the app: it enforces the human signature, carries the money and lets anyone verify.

| Hedera service | Role in EL JOKER | Why it matters |
|---|---|---|
| Consensus Service (HCS) | Each decision (mission, AI recommendation, verification, guardian decision, payment) is published as a SHA-256 fingerprint, chained to the previous one, on topic `0.0.11007004`. | A database can be rewritten, even by us; Hedera's ordered, timestamped record cannot. Editing a price, recomputing every hash or deleting a payment record is detected. |
| Scheduled transactions + threshold key | Payments above the limit come from a vault whose key is 2-of-2 (agents + human approver). Kanawita creates a scheduled transfer signed by the agents; the approver's signature makes Hedera execute it; a rejection deletes the schedule. | The human approval is enforced by the ledger, not by our server. Even someone who steals the server's key cannot empty the vault. |
| Token Service (HTS) | EJTND, a demo dinar token (1 EJTND = 1 TND, 3 decimals, fixed supply, no admin key), pays the full offer amount. | Suppliers are paid a stable amount in dinars instead of a volatile coin; the transfer is instant and traceable. |
| Mirror Node + HashScan | The app confirms every payment on the Mirror Node; the public `/verify` page reads the Mirror Node directly from the browser and recomputes every hash. | Verification does not require trusting EL JOKER. |

Only fingerprints go on-chain: no names, prices or documents. Each proof costs a fraction of a cent, with fees fixed in USD.

## What works today (Proof of Concept)

- Live on Hedera testnet with real AI (Claude): `npm run demo:check` passed **11/11** on 2026-10-19 — the nine scenarios A–I, deleted-event detection, and the independent public verifier, vault and EJTND included.
- Scenarios: approved purchase paid in EJTND; budget too small (blocked); duplicate payment (refused, HTTP 409); unverified supplier picked by the AI (blocked); large purchase locked in the vault then released by the human co-signature; tampering detected; recycled invoice (blocked); company purchase under its limit (paid); company purchase above its limit (vault).
- 115 automated tests, including 7 in a real browser.

## Live testnet references

- Proof topic: https://hashscan.io/testnet/topic/0.0.11007004
- 2-of-2 vault: https://hashscan.io/testnet/account/0.0.11090535
- EJTND demo dinar token: https://hashscan.io/testnet/token/0.0.11090536
- Example payment (12,450 EJTND): https://hashscan.io/testnet/transaction/1792450276.030571723
- Example vault schedule executed after the human co-signature: https://hashscan.io/testnet/schedule/0.0.11090802

## Technology

TypeScript monorepo: Express 5 API with SQLite, Next.js 16 / React 19 web app, `@hashgraph/sdk` for Hedera, Anthropic API (Claude) for the single AI agent, Zod contracts shared by the API, the browser verifier and the tests, Vitest and Playwright.

## Innovation and differentiation

Most agent tools give either autonomy or logs. EL JOKER separates duties like a real organization (the one who chooses is not the one who approves or pays), keeps the AI out of every money decision, makes the ledger itself enforce the human co-signature above the limit, and lets anyone verify a mission from their own browser.

## Impact and adoption

First users: NGOs and grant programs that must account for every dinar to donors, then companies that want agents in procurement without losing control of spending. Model (hypothesis, not validated): a subscription per organization plus a small fee per proof. Next steps: real suppliers, approvers signing from their own wallets, two pilots in Tunisia (one NGO, one company), then a library of sector policies.

## Honest limits

Suppliers and organizations are fictional (marked "demo"). EJTND is a test token with no value; a real dinar token would need a licensed issuer and the central bank's approval. In the demo the approver key is held by the server and used only after operator + PIN approval; in production it would live in the approver's own wallet. Testnet only.

## Links

- Source code: https://github.com/rihamghoudi-bit/el-joker-2
- Pitch deck (PDF): https://github.com/rihamghoudi-bit/el-joker-2/blob/main/docs/pitch/EL_JOKER_Pitch_Deck.pdf
- How to run the demo: README → Quick start; jury script in `docs/DEMO.md`
- Demo video: _add the link once recorded (e.g. an unlisted YouTube video)_
