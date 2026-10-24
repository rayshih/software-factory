import { describe, expect, it } from "vitest";
import { sanitizeFields } from "../src/log.js";

describe("sanitizeFields", () => {
  it("redacts nested credential keys, including camelCase", () => {
    const nested: Record<string, unknown> = { api_key: "secret-value", ok: true };
    nested.self = nested;

    expect(
      sanitizeFields({
        token: "ghs_abc",
        tokens: 12,
        githubAppPrivateKey: "pem",
        anthropicApiKey: "sk-ant",
        authorization: "Bearer secret",
        private_key: "pem",
        nested,
        list: [
          { webhookSecret: "s", installationToken: "ghs_nested" },
          { repo: "rayshih/sf-demo-todo-api" },
        ],
      }),
    ).toEqual({
      token: "[redacted]",
      tokens: 12,
      githubAppPrivateKey: "[redacted]",
      anthropicApiKey: "[redacted]",
      authorization: "[redacted]",
      private_key: "[redacted]",
      nested: { api_key: "[redacted]", ok: true, self: "[redacted]" },
      list: [
        { webhookSecret: "[redacted]", installationToken: "[redacted]" },
        { repo: "rayshih/sf-demo-todo-api" },
      ],
    });
  });

  it("returns an empty object when there are no fields", () => {
    expect(sanitizeFields(undefined)).toEqual({});
  });
});
