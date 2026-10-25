import { createHash } from "node:crypto";

export interface FileChange {
  path: string;
  content: string;
}

export const CONTENT_HASH_TRAILER = "Factory-Content-Hash:";

export function contentHash(files: readonly FileChange[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFiles(files)))
    .digest("hex");
}

export function operationHash(
  branch: string,
  issueNumber: number,
  files: readonly FileChange[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ branch, issueNumber, files: canonicalFiles(files) }))
    .digest("hex");
}

function canonicalFiles(files: readonly FileChange[]): FileChange[] {
  return [...files]
    .map((file) => ({ path: file.path, content: file.content }))
    .sort(
      (left, right) =>
        compareOrdinal(left.path, right.path) ||
        compareOrdinal(left.content, right.content),
    );
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function commitMessage(issueNumber: number, hash: string): string {
  return `Apply changes for issue #${issueNumber}\n\n${CONTENT_HASH_TRAILER} ${hash}\n`;
}

export function messageHasContentHash(message: string, hash: string): boolean {
  return message.includes(`${CONTENT_HASH_TRAILER} ${hash}`);
}
