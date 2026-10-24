import { describe, expect, it, vi } from "vitest";
import { findIssueCommentByMarker } from "../src/github/issue-comment.js";

describe("findIssueCommentByMarker", () => {
  it("searches beyond five full pages", async () => {
    const marker = "<!-- software-factory:pr-link -->";
    const listPage = vi.fn(async (page: number) =>
      Array.from({ length: 100 }, (_, index) => ({
        id: (page - 1) * 100 + index + 1,
        body: page === 6 && index === 0 ? marker : "unrelated",
      })),
    );

    await expect(findIssueCommentByMarker(marker, listPage)).resolves.toBe(501);
    expect(listPage).toHaveBeenCalledTimes(6);
  });
});
