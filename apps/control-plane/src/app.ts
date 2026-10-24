import { Hono } from "hono";
import type { WebhookDependencies } from "./pipeline.js";
import { handleGithubWebhook } from "./webhooks/github.js";

export function createApp(deps: WebhookDependencies): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/webhooks/github", async (c) => {
    const rawBody = Buffer.from(await c.req.arrayBuffer());
    const result = await handleGithubWebhook(deps, {
      rawBody,
      signature: c.req.header("x-hub-signature-256"),
      deliveryId: c.req.header("x-github-delivery"),
      eventName: c.req.header("x-github-event"),
    });
    return c.json(result.body, result.status);
  });

  return app;
}
