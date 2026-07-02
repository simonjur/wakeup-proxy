import { defineConfig } from "vitest/config";

// End-to-end tests spawn the real proxy + a real browser, so they need
// generous timeouts and must not run in parallel (they bind real ports).
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
});
