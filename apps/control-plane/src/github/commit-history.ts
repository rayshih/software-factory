import { messageHasContentHash } from "./content-hash.js";

/** Two pages. Past this, the lookup cannot tell "absent" from "older than the window". */
export const COMMIT_HISTORY_PAGE_SIZE = 100;
export const COMMIT_HISTORY_LOOKUP_LIMIT = 200;

/**
 * The branch history filled the lookup window without a matching operation hash.
 * The caller must not create a commit: an older matching commit may still exist.
 * The orchestrator handles this failure and reevaluates the repository.
 */
export class CommitHistoryLookupLimitError extends Error {
  readonly branch: string;
  readonly limit: number;

  constructor(branch: string, limit: number) {
    super(
      `commit history lookup on ${branch} reached ${limit} commits without finding the operation hash`,
    );
    this.name = "CommitHistoryLookupLimitError";
    this.branch = branch;
    this.limit = limit;
  }
}

/**
 * Searches history starting at `headSha`. Every page is read from that commit,
 * not from the branch name, so a commit that lands on the branch mid-lookup
 * cannot shift later pages.
 */
export async function findContentHashInHistory(
  branch: string,
  headSha: string,
  hash: string,
  listPage: (page: number, headSha: string) => Promise<readonly { message: string }[]>,
): Promise<boolean> {
  if (headSha.length === 0) {
    throw new Error(`commit history lookup on ${branch} requires a captured head SHA`);
  }
  const maxPages = COMMIT_HISTORY_LOOKUP_LIMIT / COMMIT_HISTORY_PAGE_SIZE;
  for (let page = 1; page <= maxPages; page += 1) {
    const commits = await listPage(page, headSha);
    if (commits.some((commit) => messageHasContentHash(commit.message, hash))) return true;
    if (commits.length < COMMIT_HISTORY_PAGE_SIZE) return false;
  }
  throw new CommitHistoryLookupLimitError(branch, COMMIT_HISTORY_LOOKUP_LIMIT);
}
