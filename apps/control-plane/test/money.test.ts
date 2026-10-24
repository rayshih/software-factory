import { describe, expect, it } from "vitest";
import { addUsd, formatUsd, usdFromMinorUnits } from "../src/money.js";

describe("money", () => {
  it("adds decimal dollars and converts Anthropic minor units", () => {
    expect(formatUsd("0")).toBe("0.000000");
    expect(addUsd("1.250000", "0.250000")).toBe("1.500000");
    expect(usdFromMinorUnits("2500")).toBe("25.000000");
    expect(usdFromMinorUnits("50")).toBe("0.500000");
  });
});
