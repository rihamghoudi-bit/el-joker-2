import type { ApprovalRequest, MissionState, MissionSummary, PublicConfig, ScenarioInfo, TrailVerification } from "@eljoker/shared";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body?.code, body?.details);
  return body as T;
}

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
  mission: (id: string) => call<MissionState>(`/api/missions/${id}`),
  runScenario: (id: string) => call<{ missionId: string }>(`/api/scenarios/${id}/run`, { method: "POST" }),
  createFromText: (text: string) => call<{ missionId: string; status: string; missingFields: string[] }>("/api/missions", { method: "POST", body: JSON.stringify({ text }) }),
  approve: (id: string, body: ApprovalRequest) => call<{ decision: string }>(`/api/missions/${id}/approvals`, { method: "POST", body: JSON.stringify(body) }),
  replay: (id: string) => call<ReplayResult>(`/api/missions/${id}/payments/replay`, { method: "POST" }),
  verify: (id: string) => call<TrailVerification>(`/api/missions/${id}/verify`, { method: "POST" }),
  tamper: (id: string, mode: "EDIT_EVIDENCE" | "REWRITE_HASHES") => call<TamperResult>(`/api/missions/${id}/tamper`, { method: "POST", body: JSON.stringify({ mode }) }),
  reset: () => call<{ ok: boolean }>("/api/demo/reset", { method: "POST" }),
};
