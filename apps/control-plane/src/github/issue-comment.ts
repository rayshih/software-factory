const COMMENT_PAGE_SIZE = 100;
const OPERATION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type IssueComment = {
  id: number;
  body?: string | null;
  user?: { login?: string | null; type?: string | null } | null;
  performed_via_github_app?: { id?: number | null; slug?: string | null } | null;
};

/** Hidden HTML comment that identifies one factory operation. */
export function operationMarker(operationKey: string): string {
  if (!OPERATION_KEY.test(operationKey)) {
    throw new Error(`invalid operation key: ${operationKey}`);
  }
  return `<!-- forgeline:op=${operationKey} -->`;
}

export function isOperationMarker(marker: string): boolean {
  return /^<!-- forgeline:op=[A-Za-z0-9][A-Za-z0-9._-]* -->$/.test(marker);
}

/** True when a whole line is exactly the marker. A quoted marker inside a sentence does not match. */
export function commentHasExactMarker(body: string | null | undefined, marker: string): boolean {
  if (!body || !isOperationMarker(marker)) return false;
  return body.split(/\r?\n/).some((line) => line.trim() === marker);
}

/**
 * A comment this GitHub App wrote. `performed_via_github_app.id` is the app id
 * this client was constructed with. When the slug is present, the author login
 * must be that app's `{slug}[bot]` account. Human comments and other bots do
 * not match.
 */
export function isOurAppComment(comment: IssueComment, appId: number): boolean {
  if (comment.user?.type !== "Bot") return false;
  const via = comment.performed_via_github_app;
  if (!via || via.id !== appId) return false;
  if (via.slug && comment.user.login !== `${via.slug}[bot]`) return false;
  return true;
}

export function issueCommentBody(body: string, marker: string): string {
  if (!isOperationMarker(marker)) {
    throw new Error(`marker must come from operationMarker(): ${marker}`);
  }
  if (commentHasExactMarker(body, marker)) return body;
  return `${body}\n\n${marker}`;
}

export async function findIssueCommentByMarker(
  marker: string,
  listPage: (page: number) => Promise<readonly IssueComment[]>,
): Promise<number | null> {
  for (let page = 1; ; page += 1) {
    const comments = await listPage(page);
    const match = comments.find((comment) => commentHasExactMarker(comment.body, marker));
    if (match) return match.id;
    if (comments.length < COMMENT_PAGE_SIZE) return null;
  }
}

/** Every comment id whose body has the marker on its own line, oldest page first. */
export async function listIssueCommentIdsByMarker(
  marker: string,
  listPage: (page: number) => Promise<readonly IssueComment[]>,
): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; ; page += 1) {
    const comments = await listPage(page);
    for (const comment of comments) {
      if (commentHasExactMarker(comment.body, marker)) ids.push(comment.id);
    }
    if (comments.length < COMMENT_PAGE_SIZE) return ids;
  }
}

/**
 * Keeps the lowest id and deletes the rest. Callers pass only comments this
 * app owns. Overlapping workers can both create a comment; the next read
 * collapses those copies to one.
 */
export async function keepCanonicalComment(
  ids: readonly number[],
  deleteComment: (id: number) => Promise<void>,
): Promise<number> {
  if (ids.length === 0) throw new Error("keepCanonicalComment requires at least one comment");
  const canonical = Math.min(...ids);
  for (const id of ids) {
    if (id !== canonical) await deleteComment(id);
  }
  return canonical;
}
