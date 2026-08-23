import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pgvitals/db": resolve(__dirname, "packages/db/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["apps/collector/tests/**/*.test.ts"],
  },
});

