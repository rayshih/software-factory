import type { FileChange } from "./content-hash.js";

export const DEFAULT_MAX_FILES = 50;
export const DEFAULT_MAX_FILE_BYTES = 1_048_576;
export const DEFAULT_MAX_TOTAL_BYTES = 5_242_880;

export interface PushGuardLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export class PushRejectedError extends Error {
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "PushRejectedError";
    this.path = path;
  }
}

export interface PushCheck {
  sensitivePaths: string[];
}

/** Rejects unsafe paths and reports sensitive ones that are still allowed. */
export function checkPush(input: {
  repo: string;
  branch: string;
  issueNumber: number;
  files: readonly FileChange[];
  allowedRepos?: ReadonlySet<string>;
  limits?: Partial<PushGuardLimits>;
  /** The production client always sets this. The in-memory fake sets it with an allowlist. */
  requireFactoryBranch?: boolean;
}): PushCheck {
  if (input.allowedRepos && !input.allowedRepos.has(input.repo)) {
    throw new PushRejectedError(`repository ${input.repo} is not allowlisted`);
  }
  if (input.requireFactoryBranch || input.allowedRepos) {
    if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) {
      throw new PushRejectedError(`invalid issue number: ${input.issueNumber}`);
    }
    const expectedBranch = `factory/issue-${input.issueNumber}`;
    if (input.branch !== expectedBranch) {
      throw new PushRejectedError(
        `branch ${input.branch} does not match issue #${input.issueNumber}`,
      );
    }
  }
  const limits: PushGuardLimits = {
    maxFiles: input.limits?.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: input.limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: input.limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
  if (input.files.length > limits.maxFiles) {
    throw new PushRejectedError(
      `push has ${input.files.length} files; limit is ${limits.maxFiles}`,
    );
  }
  let total = 0;
  const sensitivePaths: string[] = [];
  for (const file of input.files) {
    assertSafePath(file.path);
    const bytes = Buffer.byteLength(file.content);
    if (bytes > limits.maxFileBytes) {
      throw new PushRejectedError(
        `${file.path} is ${bytes} bytes; limit is ${limits.maxFileBytes}`,
        file.path,
      );
    }
    total += bytes;
    if (isSecretPath(file.path)) {
      throw new PushRejectedError(`${file.path} looks like a secret file`, file.path);
    }
    if (isSensitivePath(file.path)) sensitivePaths.push(file.path);
  }
  if (total > limits.maxTotalBytes) {
    throw new PushRejectedError(`push is ${total} bytes; limit is ${limits.maxTotalBytes}`);
  }
  return { sensitivePaths };
}

export function sensitivePullNote(paths: readonly string[]): string {
  return [
    "touches-sensitive-paths:",
    ...paths.map((path) => `- ${path}`),
    "A human must review these paths. Software Factory does not block them.",
  ].join("\n");
}

export const SENSITIVE_PATH_LABEL = "touches-sensitive-paths";

function assertSafePath(path: string): void {
  if (path.length === 0) throw new PushRejectedError("path is empty", path);
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new PushRejectedError(`${path} is an absolute path`, path);
  }
  if (path.includes("\\")) throw new PushRejectedError(`${path} contains a backslash`, path);
  if (hasControlCharacter(path)) {
    throw new PushRejectedError(`${path} contains a control character`, path);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0) throw new PushRejectedError(`${path} has an empty segment`, path);
    if (segment === "..") throw new PushRejectedError(`${path} escapes the repository`, path);
    if (segment.toLowerCase() === ".git") {
      throw new PushRejectedError(`${path} is inside .git`, path);
    }
  }
}

function hasControlCharacter(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function baseName(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function isSecretPath(path: string): boolean {
  const base = baseName(path).toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  return base === "id_rsa" || base === "id_ed25519" || base === "credentials.json";
}

function isSensitivePath(path: string): boolean {
  if (path === ".github/workflows" || path.startsWith(".github/workflows/")) return true;
  if (path === ".github/actions" || path.startsWith(".github/actions/")) return true;
  const base = baseName(path);
  if (
    base === "CODEOWNERS" ||
    base === "Dockerfile" ||
    base === "render.yaml" ||
    base === "fly.toml"
  ) {
    return true;
  }
  return base.endsWith(".tf");
}
