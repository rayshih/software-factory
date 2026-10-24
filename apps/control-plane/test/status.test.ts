import { describe, expect, it } from "vitest";
import { assertCanTransition, canTransition } from "../src/tasks/status.js";

describe("status transitions", () => {
  it("allows the factory path and rejects skipping ahead to accepted", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "pr_opened")).toBe(true);
    expect(canTransition("pr_opened", "ci_passed")).toBe(true);
    expect(canTransition("ci_passed", "needs_human")).toBe(true);
    expect(canTransition("needs_human", "accepted")).toBe(true);
    expect(canTransition("needs_human", "rejected")).toBe(true);
    expect(canTransition("pr_opened", "ci_failed")).toBe(true);
    expect(canTransition("needs_human", "queued")).toBe(true);
    expect(canTransition("queued", "accepted")).toBe(false);
    expect(canTransition("running", "accepted")).toBe(false);
    expect(canTransition("accepted", "queued")).toBe(false);
    expect(() => assertCanTransition("failed", "pr_opened")).toThrow(
      /invalid task status transition/,
    );
  });
});
