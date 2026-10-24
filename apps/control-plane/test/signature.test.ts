import { describe, expect, it } from "vitest";
import { signGithubBody, verifyGithubSignature } from "../src/github/signature.js";

describe("GitHub webhook signature", () => {
  const body = Buffer.from('{"ok":true}');
  const secret = "top-secret";

  it("accepts a matching sha256 signature", () => {
    expect(verifyGithubSignature(body, signGithubBody(body, secret), secret)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, a missing header, and a non-sha256 scheme", () => {
    expect(verifyGithubSignature(body, signGithubBody(body, "other"), secret)).toBe(false);
    expect(
      verifyGithubSignature(Buffer.from("tampered"), signGithubBody(body, secret), secret),
    ).toBe(false);
    expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
    expect(verifyGithubSignature(body, "sha1=abcdef", secret)).toBe(false);
  });

  it("rejects a signature with a different length without throwing", () => {
    expect(verifyGithubSignature(body, "sha256=abcd", secret)).toBe(false);
    expect(verifyGithubSignature(body, "sha256=" + "aa".repeat(40), secret)).toBe(false);
  });
});
