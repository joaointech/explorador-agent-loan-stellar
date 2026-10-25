import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `@/…` alias from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
