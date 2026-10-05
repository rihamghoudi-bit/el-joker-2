import { createHash, randomUUID } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively, no whitespace, arrays keep order.
 * Equivalent input objects always produce byte-identical output, so their SHA-256 is stable.
 * Rejects values that JSON cannot represent faithfully (undefined in arrays, NaN, Infinity, functions).
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalize: non-finite number");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => {
          if (v === undefined) throw new Error("canonicalize: undefined in array");
          return canonicalize(v);
        }).join(",") + "]";
      }
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

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
