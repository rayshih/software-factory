export function normalizeRepo(fullName: string): string {
  return fullName.trim().toLowerCase();
}

export function parseRepo(fullName: string): { owner: string; repo: string } {
  const normalized = normalizeRepo(fullName);
  const parts = normalized.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid repository name: ${fullName}`);
  }
  return { owner: parts[0], repo: parts[1] };
}
