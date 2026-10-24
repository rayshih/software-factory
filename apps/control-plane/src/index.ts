import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createWebhookDependencies } from "./dependencies.js";
import { consoleLogger } from "./log.js";

const config = loadServerConfig(process.env);
const deps = await createWebhookDependencies(process.env);
const app = createApp(deps);

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  consoleLogger.info("control plane listening", { port: info.port });
});
