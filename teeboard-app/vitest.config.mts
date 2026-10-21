import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/lib/scoring/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/scoring/src/**/*.ts"],
      thresholds: {
        lines: 95,
        branches: 95,
      },
    },
  },
});
