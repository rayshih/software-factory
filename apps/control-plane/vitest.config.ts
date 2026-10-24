import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each PGlite test boots its own database. On CI several files do that at
    // once, and a test that boots more than one can pass the 5s default.
    testTimeout: 20_000,
  },
});
