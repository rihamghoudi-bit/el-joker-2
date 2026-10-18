# EL JOKER 2.0 — Jury demo script

## Before going on stage

```bash
npm run seed        # clean mission history (demo data re-seeded)
npm run demo        # production build + start (API :4000, UI :3000)
npm run demo:check  # optional dry run of every scenario (spends a little testnet HBAR / EJUSD when live)
```

- Header chips: **AI · claude-…** (or *fallback*), **Hedera testnet · 0.0.x** (or *simulated*), **Vault 2-of-2 · 0.0.x**, **Pays in EJUSD (HTS)**.
- Projector or weak laptop → click **Motion: off**.
- Open the topic on HashScan in a second tab (link next to the Hedera chip).
- Operator PIN: `0619` (or your `DEMO_OPERATOR_PIN`).
- No network at the venue → `LEDGER_MODE=simulated` and `AI_ENABLED=false` in `.env`: everything runs, clearly labeled SIMULATED / FALLBACK.

---

## 3-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Landing page | “AI agents are starting to spend money. EL JOKER is the control layer: one AI proposes, rules decide, Hedera proves — and above the limit, the money sits in a Hedera vault that only a human co-signature opens.” |
| 0:15 | *Go for EL JOKER* → press send on the pre-filled request (**A**) | “An NGO, 500 people in Gabès, $5,000. Lemhaf ranks offers, Nasnes verifies, 3ases applies the NGO's rules with no LLM, Kanawita pays 4,150.00 EJUSD — and each decision appears in *Live Hedera proofs*.” |
| 0:55 | Chip **I** (ACME) → send | “Same engine, a company: 12 laptops, $11,820, above ACME's $2,000 limit. Kanawita can't pay: it locks the payment on Hedera — 1 of 2 signatures.” Click *schedule* on HashScan. |
| 1:30 | Approval card: reason + PIN → Approve | “The approver co-signs, and Hedera itself executes the transfer. Reject, and the schedule is deleted. The agents' key alone can never move the vault.” |
| 2:00 | *Proof & verify* → *Insider rewrites hashes too* → *Open the public verifier* | “An insider rewrites the price and every hash. Don't trust us: this page reads Hedera from your browser and recomputes everything — TAMPERING DETECTED.” |
| 2:40 | Close | “AI proposes. Rules decide. Humans co-sign on Hedera. Hedera proves. Autonomous, but never uncontrolled.” |

## 5-minute version

| Time | Action | Say |
|---|---|---|
| 0:00 | Landing | Problem: agents that buy and pay are coming; organizations must choose between autonomy and control. EL JOKER removes the trade-off. |
| 0:25 | **A** approved (NGO) | Walk the conversation: request → Lem3alem → Lemhaf (REAL AI chip vs FALLBACK label) → Nasnes 10 checks → 3ases 12 checks shown, risk LOW → Kanawita receipt SUCCESS, 4,150.00 EJUSD. Live Hedera proofs + HashScan. |
| 1:15 | **D** unverified supplier | The AI's attractive pick rejected by Nasnes; blocked. “The AI can be wrong; it can't spend.” |
| 1:40 | **C** replay on A | Replay → 409 + reasons; `PAYMENT_BLOCKED` on HCS; still one payment. |
| 2:00 | **H** then **I** (ACME) | Same agents, ACME policy 1.0.0: H ($1,140) paid autonomously; I ($11,820) → HUMAN REVIEW → **locked in the vault** (`PAYMENT_SCHEDULED`, 1 of 2). Show the schedule on HashScan (pending). |
| 3:00 | Approve I | Wrong PIN refused, then reason + PIN → approver co-signs → Hedera executes → PAID; HashScan shows the schedule executed with 2 signatures. |
| 3:40 | **F** + public verifier | Verify → VALID. *Insider rewrites hashes too* → open `/verify?mission=…` → the browser reads the Mirror Node, recomputes → TAMPERING DETECTED (3 events don't match). |
| 4:30 | Close | Business: the control layer for agentic spending — first market NGOs (accountability to donors), then company procurement (hypotheses — no customers claimed). Thesis line. |

## Fallback plan

- **No internet / Anthropic down** → Lemhaf shows `FALLBACK · rule-based` with the reason. Nothing pretends to be Claude.
- **Hedera slow** → proofs show “consensus…”. Kanawita waits for the authorization proof (up to 45 s) before paying. Verification may show PENDING until the Mirror Node indexes the message: press Verify again.
- **Vault not configured** → above the limit the payment simply stays on hold until approval, then pays from the agents' account (the old behavior). Run `npm run hedera:setup -- --vault --stablecoin` to enable it.
- **No credentials** → everything runs on the clearly labeled SIMULATED ledger and vault (no tx ids, no HashScan links).
- **Stutter on the projector** → Motion: off.
