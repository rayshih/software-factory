import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addUsd, formatUsd, usdFromMinorUnits } from "../src/money.js";
import { tasksToCsv, TRACKER_COLUMNS } from "../src/tasks/csv.js";
import { usageToTracking } from "../src/agent/usage.js";
import { createDeps, labeledPayload, postGithub } from "./helpers.js";

describe("tracker csv", () => {
  it("uses the metrics/tracker.csv header", () => {
    const header = readFileSync(
      new URL("../../../metrics/tracker.csv", import.meta.url),
      "utf8",
    ).split(/\r?\n/)[0];
    expect(header).toBe(TRACKER_COLUMNS.join(","));
  });

  it("exports task fields, including zero cost, and escapes commas", async () => {
    const { deps } = await createDeps();
    const response = await postGithub(deps, "issues", "csv-delivery", labeledPayload());
    const { taskId } = (await response.json()) as { taskId: string };
    await deps.store.updateTask(taskId, {
      status: "failed",
      failureCategory: 'needs, "review"',
      costUsd: "0.000000",
      finishedAt: new Date("2026-10-26T00:01:00.000Z"),
      startedAt: new Date("2026-10-26T00:00:00.000Z"),
      attempts: 2,
    });
    const task = await deps.store.getTask(taskId);
    if (!task) throw new Error("missing task");
    const csv = tasksToCsv([task]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe(TRACKER_COLUMNS.join(","));
    expect(row).toContain(taskId);
    expect(row).toContain('"needs, ""review"""');
    expect(row).toContain("0.000000");
    expect(row?.split(",")[7]).toBe("1");
  });
});

describe("money", () => {
  it("adds decimal dollars and converts Anthropic minor units", () => {
    expect(formatUsd("0")).toBe("0.000000");
    expect(addUsd("1.250000", "0.250000")).toBe("1.500000");
    expect(usdFromMinorUnits("2500")).toBe("25.000000");
    expect(usdFromMinorUnits("50")).toBe("0.500000");
    expect(
      usageToTracking({
        input_tokens: 3,
        output_tokens: 4,
        list_cost: { amount: "50", currency: "USD" },
      }),
    ).toEqual({
      costUsd: "0.500000",
      tokens: 7,
    });
    expect(usageToTracking(undefined)).toEqual({ costUsd: "0.000000", tokens: 0 });
  });
});
