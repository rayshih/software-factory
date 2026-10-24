export function isHttpStatus(error: unknown, status: number): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("status" in current && current.status === status) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** Postgres SQLSTATE unique_violation. postgres.js and Drizzle put this on `error.code`. */
const POSTGRES_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === POSTGRES_UNIQUE_VIOLATION) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
