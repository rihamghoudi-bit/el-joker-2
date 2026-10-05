/**
 * Minimal structured JSON logger with secret redaction.
 * Every line is one JSON object: {ts, level, msg, ...fields}.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEYS = /key|secret|token|password|private/i;
// Hex/DER private keys and Anthropic keys must never reach a log line.
const SECRET_VALUES = [/sk-ant-[A-Za-z0-9_-]+/g, /\b(302e|3030)[0-9a-f]{40,}\b/gi, /\b0x[0-9a-f]{64}\b/gi];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") return SECRET_VALUES.reduce((s, re) => s.replace(re, "[REDACTED]"), value);
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) && !/hash|idempotency/i.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

let minLevel: Level = (process.env.LOG_LEVEL as Level) || "info";
let silent = process.env.VITEST === "true" && !process.env.LOG_IN_TESTS;

export function setLogLevel(level: Level) {
  minLevel = level;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (silent || order[level] < order[minLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(fields ?? {}) as object) });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
  silence: (v: boolean) => {
    silent = v;
  },
};
export { redact };
