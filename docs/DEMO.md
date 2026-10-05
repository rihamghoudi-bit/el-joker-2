# EL JOKER 2.0 — Jury demo script

## Before going on stage

```bash
npm run seed        # clean mission history (demo data re-seeded)
npm run demo        # production build + start (API :4000, UI :3000)
npm run demo:check  # optional dry run of every scenario (spends a little testnet HBAR when live)
```

- Header chips: **AI · claude-…** (or *fallback*) and **Hedera testnet · 0.0.x** (or *simulated*).
- Projector or weak laptop → click **Motion: off**.
- Open the topic on HashScan in a second tab (link next to the Hedera chip).
- Operator PIN: `0619` (or your `DEMO_OPERATOR_PIN`).

---

## 3-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Landing page | “EL JOKER lets agents run emergency procurement — but only one of them is AI, and it only *recommends*. A deterministic guardian decides, humans control high-risk spending, and Hedera proves everything.” |
| 0:15 | *Go for EL JOKER* → press send on the pre-filled request (**A**) | “500 people in Gabès, $5,000. Watch the conversation: Lemhaf ranks offers, Nasnes verifies the evidence, 3ases applies 13 rules with no LLM, Kanawita pays on testnet — and each decision appears in *Live Hedera proofs*.” Click a HashScan link. |
| 1:05 | Chip **D** → send | “Rush order. The AI picks the cheapest broker. Nasnes: not in the registry, no license, implausible prices → rejected. AI cannot bypass security.” |
| 1:35 | Back on mission A → *Replay payment (attack)* | “Same payment twice → rejected: idempotency + one payment per mission, enforced by the database. The attempt itself is proven on Hedera.” |
| 2:00 | *Proof & verify* → Verify → *Insider rewrites hashes too* → Verify | “An insider changes the approved price and recomputes every local hash. A normal database can't tell. Hedera can: TAMPERING DETECTED.” |
| 2:40 | Close | “AI proposes. Verification checks. Deterministic policy decides. Humans control risk. Hedera proves.” |

## 5-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Landing | Problem: NGOs need speed in emergencies, but autonomous AI spending without control and proof is unacceptable. |
| 0:25 | **A** approved | Walk the conversation: your request → Lem3alem → Lemhaf (REAL AI chip vs FALLBACK label) → Nasnes 10 checks → 3ases 13 checks, risk LOW → Kanawita receipt SUCCESS, 1.0375 ℏ (proportional to the $4,150 offer). Live Hedera proofs + HashScan. |
| 1:20 | **B** budget block | $100 budget → BLOCKED, Kanawita idle, `GUARDIAN_BLOCKED` anchored. |
| 1:45 | **D** unverified supplier | AI's attractive pick rejected by Nasnes; blocked. |
| 2:10 | **G** recycled invoice | A *verified* supplier, cheaper — but its invoice number was already used by an earlier mission → rejected. “Even a trusted supplier can't double-bill.” |
| 2:35 | **E** human review | $16,600 > $5,000 → HUMAN REVIEW, payment on hold. Approval card in the conversation: show a wrong PIN being refused, then approve with reason + PIN → re-evaluated → 4.15 ℏ paid. “The approval is bound to the exact facts the operator saw.” |
| 3:35 | **C** replay | Replay on A or E → 409 + reasons; `PAYMENT_BLOCKED` on HCS. |
| 4:00 | **F** tampering | Verify → VALID (Local record vs Hedera proof vs Result). *Delete last event* → Verify → “Missing — deleted from the local database · proof still on the ledger” → TAMPERING DETECTED. “Deleting history doesn't work either.” |
| 4:40 | Close | Business: NGOs, humanitarian and grant programs; B2B SaaS / proof-volume pricing (hypotheses — no customers claimed). Thesis line. |

## Fallback plan

- **No internet / Anthropic down** → Lemhaf shows `FALLBACK · rule-based` with the reason. Nothing pretends to be Claude.
- **Hedera slow** → proofs show “consensus…”. Kanawita waits for the authorization proof (up to 45 s) before paying. Verification may show PENDING until the Mirror Node indexes the message: press Verify again.
- **No credentials** → everything runs on the clearly labeled SIMULATED ledger (no tx ids, no HashScan links).
- **Stutter on the projector** → Motion: off.
