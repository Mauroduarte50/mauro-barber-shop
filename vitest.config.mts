import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    // DB-backed tests share one Postgres connection pool; run files serially
    // to avoid advisory-lock contention across unrelated test suites.
    fileParallelism: false,
  },
});
