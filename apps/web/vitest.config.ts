import { defineConfig } from "vitest/config";

export default defineConfig({
  // Même constante de build que next.config.mjs : les tests tournent avec le backend mock autorisé.
  define: { __MOCK_BACKEND__: "true" },
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    environment: "node",
  },
});
