import type { ApprovalRequest, MissionState, MissionSummary, ProofBundle, PublicConfig, ScenarioInfo, TrailVerification } from "@eljoker/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // "no-cache" = always revalidate; the API sends ETags, so unchanged polls cost a 304.
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-cache" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body?.code, body?.details);
  return body as T;
}

export type TamperMode = "EDIT_EVIDENCE" | "REWRITE_HASHES" | "DELETE_LAST_EVENT";

export interface TamperResult {
  eventId: string;
  eventType: string;
  field: string;
  before: unknown;
  after: unknown;
}

export interface ReplayResult {
  executed: boolean;
  reasons: string[];
}

export const api = {
  config: () => call<PublicConfig>("/api/config"),
  scenarios: () => call<ScenarioInfo[]>("/api/scenarios"),
  missions: () => call<MissionSummary[]>("/api/missions"),
  mission: (id: string, payloads = false) => call<MissionState>(`/api/missions/${id}${payloads ? "?payloads=1" : ""}`),
  runScenario: (id: string) => call<{ missionId: string }>(`/api/scenarios/${id}/run`, { method: "POST" }),
  createFromText: (text: string) => call<{ missionId: string; status: string; missingFields: string[] }>("/api/missions", { method: "POST", body: JSON.stringify({ text }) }),
  approve: (id: string, body: ApprovalRequest) => call<{ decision: string }>(`/api/missions/${id}/approvals`, { method: "POST", body: JSON.stringify(body) }),
  replay: (id: string) => call<ReplayResult>(`/api/missions/${id}/payments/replay`, { method: "POST" }),
  verify: (id: string) => call<TrailVerification>(`/api/missions/${id}/verify`, { method: "POST" }),
  tamper: (id: string, mode: TamperMode) => call<TamperResult>(`/api/missions/${id}/tamper`, { method: "POST", body: JSON.stringify({ mode }) }),
  reset: () => call<{ ok: boolean }>("/api/demo/reset", { method: "POST" }),
  /** What the server claims about a mission. The public verifier checks it instead of trusting it. */
  bundle: (id: string) => call<ProofBundle>(`/api/public/missions/${encodeURIComponent(id)}/bundle`),
};
