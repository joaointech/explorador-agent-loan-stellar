import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `@/` alias from tsconfig.json, like Next.js does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".next/**", "lib/generated/**"],
  },
});
