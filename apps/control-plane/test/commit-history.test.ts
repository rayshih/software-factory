import { describe, expect, it, vi } from "vitest";
import {
  COMMIT_HISTORY_PAGE_SIZE,
  findContentHashInHistory,
} from "../src/github/commit-history.js";
import { commitMessage } from "../src/github/content-hash.js";

describe("findContentHashInHistory", () => {
  it("reads every page from the captured head SHA", async () => {
    const headSha = "captured-head";
    const seen: string[] = [];
    const hash = "abc123";
    const listPage = vi.fn(async (page: number, pinned: string) => {
      seen.push(pinned);
      if (page === 1) {
        return Array.from({ length: COMMIT_HISTORY_PAGE_SIZE }, () => ({ message: "unrelated" }));
      }
      return [{ message: commitMessage(7, hash) }];
    });

    await expect(
      findContentHashInHistory("factory/issue-7", headSha, hash, listPage),
    ).resolves.toBe(true);
    expect(seen).toEqual([headSha, headSha]);
    expect(listPage).toHaveBeenCalledTimes(2);
  });

  it("refuses to search without a captured head", async () => {
    const listPage = vi.fn();
    await expect(findContentHashInHistory("factory/issue-7", "", "abc", listPage)).rejects.toThrow(
      /captured head SHA/,
    );
    expect(listPage).not.toHaveBeenCalled();
  });
});
