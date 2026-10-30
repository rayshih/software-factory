import { describe, expect, it } from "vitest";
import { redactText, sanitizeFields } from "../src/log.js";
import { createTestStore } from "./helpers.js";

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

  it("redacts tokens inside log text, errors, and stored event messages", async () => {
    const summary = "agent printed ghs_supersecret and sk-ant-abc_def";
    expect(redactText(summary)).toBe("agent printed [redacted] and [redacted]");
    expect(sanitizeFields({ summary })).toEqual({
      summary: "agent printed [redacted] and [redacted]",
    });

    const store = await createTestStore();
    const task = await store.createTask({
      id: crypto.randomUUID(),
      repo: "rayshih/sf-demo-todo-api",
      issueNumber: 7,
      attemptGroup: 1,
      branch: "factory/issue-7",
      installationId: 1,
      issueTitle: "Fix",
      issueBody: "",
      createdAt: new Date("2026-10-26T00:00:00.000Z"),
    });
    await store.appendEvent({
      taskId: task.id,
      type: "agent_finished",
      message: summary,
      payload: { error: "Bearer ghp_abcdefghijklmnopqrstuvwxyz" },
    });
    const [event] = await store.listEvents(task.id);
    expect(event?.message).toBe("agent printed [redacted] and [redacted]");
    expect(event?.payload).toEqual({ error: "[redacted]" });
  });
});
