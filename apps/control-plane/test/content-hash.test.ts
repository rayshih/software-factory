import { describe, expect, it } from "vitest";
import { DuplicateFilePathError, contentHash, operationHash } from "../src/github/content-hash.js";

const branch = "factory/issue-7";

describe("file path validation", () => {
  it("rejects a repeated path before hashing", () => {
    const files = [
      { path: "src/fix.ts", content: "one\n" },
      { path: "src/other.ts", content: "other\n" },
      { path: "src/fix.ts", content: "two\n" },
    ];
    expect(() => contentHash(files)).toThrow(DuplicateFilePathError);
    expect(() => operationHash(branch, 7, files)).toThrow(DuplicateFilePathError);
    try {
      operationHash(branch, 7, files);
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateFilePathError);
      expect((error as DuplicateFilePathError).path).toBe("src/fix.ts");
    }
  });

  it("rejects a repeated path even when the contents match", () => {
    const files = [
      { path: "src/fix.ts", content: "same\n" },
      { path: "src/fix.ts", content: "same\n" },
    ];
    expect(() => contentHash(files)).toThrow(/duplicate file path: src\/fix.ts/);
  });

  it("hashes unique paths in ordinal order", () => {
    const forward = [
      { path: "a.ts", content: "a\n" },
      { path: "b.ts", content: "b\n" },
    ];
    const backward = [forward[1]!, forward[0]!];
    expect(operationHash(branch, 7, backward)).toBe(operationHash(branch, 7, forward));
  });
});
