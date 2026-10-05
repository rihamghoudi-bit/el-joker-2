import type { AgentName, MissionState, PublicConfig } from "@eljoker/shared";
import { KpiStrip } from "./KpiStrip";
import { ProofFeed } from "./ProofFeed";
import { Avatar, Button, Panel } from "./ui";

const HOW_IT_WORKS: [AgentName, string][] = [
  ["LEM3ALEM", "Turns your request into a validated mission."],
  ["LEMHAF", "The AI researcher: ranks supplier offers and explains trade-offs."],
  ["NASNES", "Independently verifies the registry, the evidence and the AI's claims."],
  ["3ASES", "Deterministic policy decides — no LLM."],
  ["KANAWITA", "Pays on Hedera testnet only when authorized."],
];

/** Right-hand live panel: key numbers, live Hedera proofs, actions. Stacks under the chat on smaller screens. */
export function Dashboard({ state, config, onVerify, onReplay }: { state: MissionState | null; config: PublicConfig | null; onVerify: () => void; onReplay: () => void }) {
  if (!state) {
    return (
      <Panel title="How it works">
        <ol className="grid gap-4 p-5 text-sm text-ink-300">
          {HOW_IT_WORKS.map(([id, text]) => (
            <li key={id} className="flex items-center gap-3">
              <Avatar agent={id} size={40} />
              <span>{text}</span>
            </li>
          ))}
          <li className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/agents/hedera.png" alt="" className="h-10 w-10 rounded-full" />
            <span>Hedera records a tamper-evident proof of every decision.</span>
          </li>
        </ol>
      </Panel>
    );
  }
  return (
    <>
      <KpiStrip state={state} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2" />
      <ProofFeed state={state} config={config} />
      <Panel title="Actions">
        <div className="grid gap-3 p-5">
          <Button variant="ghost" disabled={state.auditEvents.length === 0} onClick={onVerify}>
            🔎 Verify against Hedera
          </Button>
          <Button variant="danger" disabled={state.mission.status !== "PAID" || state.busy} title="Sends exactly the same payment request again" onClick={onReplay}>
            🔁 Replay payment (attack)
          </Button>
          <p className="text-xs leading-relaxed text-ink-400">The replay goes through the same Kanawita checks as any payment. It is expected to be rejected: idempotency key + one live payment per mission, enforced by the database.</p>
        </div>
      </Panel>
    </>
  );
}
