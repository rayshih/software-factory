import { describe, expect, it, vi } from "vitest";
import {
  findIssueCommentByMarker,
  keepCanonicalComment,
  listIssueCommentIdsByMarker,
} from "../src/github/issue-comment.js";

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

  it("collects every marker comment through the last short page", async () => {
    const marker = "<!-- software-factory:pr-link -->";
    const listPage = vi.fn(async (page: number) => {
      if (page === 1) {
        return [
          { id: 2, body: marker },
          ...Array.from({ length: 99 }, (_, index) => ({ id: index + 3, body: "unrelated" })),
        ];
      }
      if (page === 2)
        return [
          { id: 150, body: `note\n${marker}` },
          { id: 151, body: "no" },
        ];
      return [];
    });

    await expect(listIssueCommentIdsByMarker(marker, listPage)).resolves.toEqual([2, 150]);
    expect(listPage).toHaveBeenCalledTimes(2);
  });
});

describe("keepCanonicalComment", () => {
  it("deletes every comment except the lowest id", async () => {
    const deleted: number[] = [];
    await expect(
      keepCanonicalComment([9, 4, 7], async (id) => {
        deleted.push(id);
      }),
    ).resolves.toBe(4);
    expect(deleted).toEqual([9, 7]);
  });
});
