import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: [
      "src/lib/scoring/test/**/*.test.ts",
      "src/lib/**/test/**/*.test.ts",
      "src/lib/**/*.test.ts",
    ],
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
