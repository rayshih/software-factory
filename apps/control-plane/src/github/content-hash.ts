import { createHash } from "node:crypto";

export interface FileChange {
  path: string;
  content: string;
}

export const CONTENT_HASH_TRAILER = "Factory-Content-Hash:";

export function contentHash(files: readonly FileChange[]): string {
  const canonical = [...files]
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function commitMessage(issueNumber: number, hash: string): string {
  return `Apply changes for issue #${issueNumber}\n\n${CONTENT_HASH_TRAILER} ${hash}\n`;
}

export function messageHasContentHash(message: string, hash: string): boolean {
  return message.includes(`${CONTENT_HASH_TRAILER} ${hash}`);
}
