import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image (deploy/Dockerfile) builds with BUILD_STANDALONE=1: a
  // self-contained server.js plus only the traced node_modules, instead of the
  // whole ~860 MB production dependency tree. `next start` and Vercel keep the
  // default output.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  // Cache Components is off on purpose: almost every page shows live chain
  // state, so the previous dynamic-by-default model is simpler (DECISIONS.md).
  reactCompiler: true,
  // Load the Stellar SDK with Node's own require on the server. Bundled, the
  // server could end up with two copies of its XDR classes, and transactions
  // built from simulated auth entries failed to serialize ("functionName:
  // expected string, Uint8Array, or XdrString") inside route handlers.
  serverExternalPackages: ["@stellar/stellar-sdk"],
  // Routes that generate Groth16 proofs read the circuit artifacts from
  // apps/web/zk at runtime (spec §8.6); file tracing can't follow those
  // process.cwd()-relative reads, so bundle them explicitly.
  outputFileTracingIncludes: {
    "/api/admin/cpcv": ["./zk/**/*"],
    "/api/admin/demo/**": ["./zk/**/*"],
  },
  // explorador.pt (../irrealista) answers every locale-less path with a 308 to
  // /pt…, and browsers cache that per origin: after running it on
  // localhost:3000, visiting / lands on /pt. Serve those paths as our own
  // routes. A rewrite, not a redirect, so it can't loop with the cached 308;
  // pages keep their server-side auth guards.
  async rewrites() {
    return [
      { source: "/pt", destination: "/" },
      { source: "/en", destination: "/" },
      { source: "/pt/:path*", destination: "/:path*" },
      { source: "/en/:path*", destination: "/:path*" },
    ];
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
