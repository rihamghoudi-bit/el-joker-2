# EL JOKER 2.0 — Jury demo script

Before going on stage:

```bash
npm run seed        # clean mission history (demo suppliers re-seeded)
npm run dev         # API :4000 + UI :3000
npm run demo:check  # optional dry run of all six scenarios (spends a little testnet HBAR when live)
```

Check the header chips: **AI: REAL · claude-…** (or FALLBACK), **HEDERA TESTNET · 0.0.x** (or SIMULATED), **POLICY 2.0.0+…**, **DEMO MODE**.
Open HashScan for the topic in a second tab (link next to the Hedera chip).

---

## 3-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Show the header + agent lineup | “EL JOKER lets AI agents run emergency procurement — but AI only *proposes*. A deterministic guardian decides, humans control high-risk spend, and Hedera proves everything. Autonomous, but never uncontrolled.” |
| 0:20 | **A** — click *Approved mission* | “500 people in Gabès need water and medicine, $5,000. Lemhaf asks Claude to rank offers, Nasnes checks the registry and evidence, 3ases applies 13 policy rules — no LLM — and Kanawita pays 1 HBAR on testnet (scaled demo amount).” Click the HashScan link. |
| 1:10 | **D** — click *Unverified supplier* | “Rush order. The AI finds a cheap broker. Nasnes: not in registry, no license, implausible prices → REJECTED. 3ases blocks. AI cannot bypass security.” |
| 1:40 | **C** — on mission A press *Replay payment (attack)* | “Same payment again → rejected: idempotency key used, one live payment per mission, enforced by the database. The attempt itself is proven on Hedera.” |
| 2:05 | **F** — on mission A: *Proof & verify* → *Verify* (VALID) → *Insider rewrites hashes too* → *Verify* | “An insider changes the approved price and recomputes all local hashes. Every local check passes — a normal database can’t tell. Hedera can: TAMPERING DETECTED.” |
| 2:45 | Close | “AI proposes. Verification checks. Deterministic policy decides. Humans control risk. Hedera proves.” |

## 5-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Header, lineup, Why-Hedera panel | Problem: NGOs need speed in emergencies but autonomous AI spending is unacceptable without control and proof. |
| 0:30 | **A** approved | Walk through each chat bubble: REAL AI chip (model name) vs FALLBACK label; Nasnes 10 checks; 3ases 13 checks + risk LOW; Kanawita receipt SUCCESS; HashScan transaction + Mirror Node confirmed. |
| 1:30 | **B** budget block | Same mission, $100. Guardian BLOCKED, Kanawita idle, `GUARDIAN_BLOCKED` anchored on HCS (show audit timeline + HashScan). |
| 2:00 | **D** unverified supplier | AI picks the attractive offer (show ranking), Nasnes rejects with evidence, 3ases blocks. |
| 2:30 | **E** human review | $16.6k > $5k autonomous limit → HUMAN REVIEW, payment on hold. Show the approval card (Guardian flags, risk factors, AI recommendation, Nasnes result, proof status). Approve as `ops-lead` with a reason → re-evaluation → paid. Mention: the approval is bound to the Guardian input hash; stale or unauthorized approvals are ignored. |
| 3:30 | **C** replay attack | Replay on mission A or E → 409 + reasons; `PAYMENT_BLOCKED` event on HCS. |
| 4:00 | **F** tampering | Verify → VALID (Local vs Hedera vs Result table). Tamper (insider mode) → Verify → TAMPERING DETECTED; show which event and which field changed; `TAMPER_DETECTED` itself anchored. |
| 4:40 | Close | Business: NGOs, humanitarian & grant programs; B2B SaaS / proof-volume pricing (hypotheses, no customers claimed). Thesis line. |

## Fallback plan

- **No internet / Anthropic down**: LEMHAF shows `FALLBACK · rule-based` with the reason. Nothing pretends to be Claude.
- **Hedera slow**: anchors show `PENDING`; Kanawita waits for the authorization proof (up to 45 s) before paying. Verification shows `PENDING` until the Mirror Node indexes the message (usually a few seconds).
- **No credentials at all**: everything runs on the clearly labeled SIMULATED ledger (no tx ids, no HashScan links).
