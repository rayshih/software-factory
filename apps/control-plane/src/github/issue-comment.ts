type IssueComment = { id: number; body?: string | null };

export function issueCommentBody(body: string, marker: string): string {
  return body.includes(marker) ? body : `${body}\n\n${marker}`;
}

export async function findIssueCommentByMarker(
  marker: string,
  listPage: (page: number) => Promise<readonly IssueComment[]>,
): Promise<number | null> {
  for (let page = 1; ; page += 1) {
    const comments = await listPage(page);
    const match = comments.find((comment) => (comment.body ?? "").includes(marker));
    if (match) return match.id;
    if (comments.length < 100) return null;
  }
}
