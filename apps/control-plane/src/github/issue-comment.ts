type IssueComment = { id: number; body?: string | null };

export function issueCommentBody(body: string, marker: string): string {
  return body.includes(marker) ? body : `${body}\n\n${marker}`;
}

const COMMENT_PAGE_SIZE = 100;

export async function findIssueCommentByMarker(
  marker: string,
  listPage: (page: number) => Promise<readonly IssueComment[]>,
): Promise<number | null> {
  for (let page = 1; ; page += 1) {
    const comments = await listPage(page);
    const match = comments.find((comment) => (comment.body ?? "").includes(marker));
    if (match) return match.id;
    if (comments.length < COMMENT_PAGE_SIZE) return null;
  }
}

/** Every comment id whose body contains the marker, oldest page first. */
export async function listIssueCommentIdsByMarker(
  marker: string,
  listPage: (page: number) => Promise<readonly IssueComment[]>,
): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; ; page += 1) {
    const comments = await listPage(page);
    for (const comment of comments) {
      if ((comment.body ?? "").includes(marker)) ids.push(comment.id);
    }
    if (comments.length < COMMENT_PAGE_SIZE) return ids;
  }
}

/**
 * Keeps the lowest id and deletes the rest. Overlapping workers can both
 * create a comment; the next read collapses them to one canonical comment.
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
