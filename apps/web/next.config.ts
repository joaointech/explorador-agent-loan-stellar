import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@advance/zk"],
  serverExternalPackages: ["snarkjs", "circomlibjs", "ffjavascript", "web-worker", "@prisma/client", "pg"],
  // Ship the circuit artifacts with the server functions that prove (§8.6), and the contract
  // wasm (its spec encodes every contract call) with every server function.
  outputFileTracingIncludes: {
    "/**/*": ["./contracts-wasm/**/*"],
    "/api/admin/cpcv": ["./zk/**/*"],
    "/api/admin/demo/reset": ["./zk/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
