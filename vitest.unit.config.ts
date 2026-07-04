import { defineConfig } from "vitest/config";

// Unit tests live next to the code under src/__tests__/, mirroring the src tree.
// They're fast and isolated (no real ports/browser), so they can run in
// parallel with default timeouts.
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
