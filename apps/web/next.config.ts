import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off on purpose: almost every page shows live chain
  // state, so the previous dynamic-by-default model is simpler (DECISIONS.md).
  reactCompiler: true,
  // Routes that generate Groth16 proofs read the circuit artifacts from
  // apps/web/zk at runtime (spec §8.6); file tracing can't follow those
  // process.cwd()-relative reads, so bundle them explicitly.
  outputFileTracingIncludes: {
    "/api/admin/cpcv": ["./zk/**/*"],
    "/api/admin/demo/**": ["./zk/**/*"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
