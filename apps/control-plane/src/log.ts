export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const REDACTED = "[redacted]";

/**
 * Compared after lowercasing and stripping underscores.
 * `token` matches `token` and keys that end in `token` (`accessToken`), not `tokens`.
 */
const SENSITIVE_STEMS = [
  "authorization",
  "privatekey",
  "apikey",
  "installationtoken",
  "secret",
  "token",
] as const;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (normalized === "tokens") return false;
  return SENSITIVE_STEMS.some((stem) => {
    if (stem === "token") return normalized === "token" || normalized.endsWith("token");
    return normalized.includes(stem);
  });
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const TOKEN_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+\S+/g,
];

/** Removes credential material from free text such as errors and agent summaries. */
export function redactText(value: string): string {
  let redacted = value;
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (typeof value === "object" && value !== null && isPlainObject(value)) {
    return sanitizeObject(value, new WeakSet());
  }
  return value;
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (typeof value === "object" && value !== null && isPlainObject(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return sanitizeObject(value, seen);
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

function sanitizeObject(
  fields: Record<string, unknown>,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(value, seen);
  }
  return safe;
}

export function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!fields) return {};
  return sanitizeObject(fields, new WeakSet());
}

export const consoleLogger: Logger = {
  info(message, fields) {
    console.log(
      JSON.stringify({ level: "info", message: redactText(message), ...sanitizeFields(fields) }),
    );
  },
  error(message, fields) {
    console.error(
      JSON.stringify({ level: "error", message: redactText(message), ...sanitizeFields(fields) }),
    );
  },
};

export const silentLogger: Logger = {
  info() {},
  error() {},
};
