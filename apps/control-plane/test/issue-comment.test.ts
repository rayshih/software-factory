import { describe, expect, it, vi } from "vitest";
import {
  commentHasExactMarker,
  findIssueCommentByMarker,
  isOurAppComment,
  keepCanonicalComment,
  listIssueCommentIdsByMarker,
  operationMarker,
} from "../src/github/issue-comment.js";

describe("findIssueCommentByMarker", () => {
  it("searches beyond five full pages", async () => {
    const marker = operationMarker("pr-link");
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
    const marker = operationMarker("pr-link");
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

describe("operation markers", () => {
  it("matches only a whole line and only this app's bot comments", () => {
    const marker = operationMarker("pr-link");
    const ours = {
      id: 1,
      body: `Opened\n\n${marker}`,
      user: { login: "forgeline-exp-bot[bot]", type: "Bot" },
      performed_via_github_app: { id: 42, slug: "forgeline-exp-bot" },
    };
    expect(commentHasExactMarker(`see ${marker} above`, marker)).toBe(false);
    expect(commentHasExactMarker(operationMarker("pr-link-extra"), marker)).toBe(false);
    expect(commentHasExactMarker(marker, marker)).toBe(true);
    expect(isOurAppComment(ours, 42)).toBe(true);
    expect(isOurAppComment({ ...ours, user: { login: "ray", type: "User" } }, 42)).toBe(false);
    expect(
      isOurAppComment(
        {
          ...ours,
          user: { login: "other[bot]", type: "Bot" },
          performed_via_github_app: { id: 99, slug: "other" },
        },
        42,
      ),
    ).toBe(false);
    expect(isOurAppComment({ ...ours, user: { login: "not-the-app[bot]", type: "Bot" } }, 42)).toBe(
      false,
    );
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
