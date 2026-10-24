export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const REDACTED_KEYS = new Set([
  "authorization",
  "token",
  "privatekey",
  "private_key",
  "secret",
  "apikey",
  "api_key",
  "installationtoken",
]);

export function sanitizeFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!fields) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return safe;
}

export const consoleLogger: Logger = {
  info(message, fields) {
    console.log(JSON.stringify({ level: "info", message, ...sanitizeFields(fields) }));
  },
  error(message, fields) {
    console.error(JSON.stringify({ level: "error", message, ...sanitizeFields(fields) }));
  },
};

export const silentLogger: Logger = {
  info() {},
  error() {},
};
