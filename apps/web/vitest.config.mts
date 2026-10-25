import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `@/` alias from tsconfig.json, like Next.js does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "lib/generated/**"],
  },
});
