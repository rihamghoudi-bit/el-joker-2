import { createHash, randomUUID } from "node:crypto";
import { canonicalize } from "@eljoker/shared";

// One canonical form for the server and the public (browser) verifier.
export { canonicalize };

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 of the canonical JSON form. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
