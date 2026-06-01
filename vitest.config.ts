import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config for the architecture migration. Tests live beside the code they
 * cover (`*.test.ts`). The `@/*` alias mirrors tsconfig so use-cases resolve
 * their ports/domain imports the same way the app does. Node environment —
 * domain and application layers have no DOM.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
