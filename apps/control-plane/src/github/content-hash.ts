import { createHash } from "node:crypto";

export interface FileChange {
  path: string;
  content: string;
}

export const CONTENT_HASH_TRAILER = "Factory-Content-Hash:";

/** The same path was supplied more than once. The operation is invalid and must not be hashed or written. */
export class DuplicateFilePathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`duplicate file path: ${path}`);
    this.name = "DuplicateFilePathError";
    this.path = path;
  }
}

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
  const seen = new Set<string>();
  const canonical = files.map((file) => {
    if (seen.has(file.path)) throw new DuplicateFilePathError(file.path);
    seen.add(file.path);
    return { path: file.path, content: file.content };
  });
  return canonical.sort((left, right) => compareOrdinal(left.path, right.path));
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
