import { Hono } from "hono";
import type { WebhookDependencies } from "./pipeline.js";
import { handleGithubWebhook } from "./webhooks/github.js";

export const MAX_GITHUB_WEBHOOK_BODY_BYTES = 1024 * 1024;

export function createApp(deps: WebhookDependencies): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/webhooks/github", async (c) => {
    const contentLength = c.req.header("content-length");
    if (
      contentLength &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > MAX_GITHUB_WEBHOOK_BODY_BYTES
    ) {
      return c.json({ ok: false, error: "payload too large" }, 413);
    }

    const rawBody = await readLimitedBody(c.req.raw, MAX_GITHUB_WEBHOOK_BODY_BYTES);
    if (rawBody === null) {
      return c.json({ ok: false, error: "payload too large" }, 413);
    }

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

async function readLimitedBody(request: Request, limit: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);

      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}
