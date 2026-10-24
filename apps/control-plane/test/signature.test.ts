import { describe, expect, it } from "vitest";
import { signGithubBody, verifyGithubSignature } from "../src/github/signature.js";
import { createApp } from "../src/app.js";
import { createDeps, WEBHOOK_SECRET } from "./helpers.js";

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

  it("serves a health check", async () => {
    const { deps } = await createDeps();
    const response = await createApp(deps).request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns 401 from the HTTP handler when the signature is wrong", async () => {
    const { deps } = await createDeps();
    const app = createApp(deps);
    const response = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-1",
        "x-github-event": "issues",
        "x-hub-signature-256": signGithubBody(Buffer.from("{}"), "nope"),
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(WEBHOOK_SECRET).not.toBe("nope");
  });
});
