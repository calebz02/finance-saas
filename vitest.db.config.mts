import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.mts";

export default mergeConfig(base, defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    // Files share one Neon test branch and truncate tables, so they must not overlap.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
}));
