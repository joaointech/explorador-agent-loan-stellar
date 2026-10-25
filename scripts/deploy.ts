// pnpm deploy:testnet — §7.4 wiring, deployments/testnet.json + Deployment row, TS bindings.
import "./_env";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { db } from "../apps/web/lib/db";
import { deployAll } from "../apps/web/lib/ops/deploy";

const root = path.resolve(import.meta.dirname, "..");
const wasmOut = path.join(root, "contracts", "target", "wasm32v1-none", "release");
const wasmDir = path.join(root, "apps", "web", "contracts-wasm");
const names = ["teurc", "cpcv_note", "advance_pool"];

if (!process.argv.includes("--no-build")) {
  console.log("Building contracts (stellar contract build)…");
  execFileSync("stellar", ["contract", "build"], { cwd: path.join(root, "contracts"), stdio: "inherit" });
}
mkdirSync(wasmDir, { recursive: true });
for (const n of names) {
  const src = path.join(wasmOut, `${n}.wasm`);
  if (existsSync(src)) copyFileSync(src, path.join(wasmDir, `${n}.wasm`));
}

const r = await deployAll();
console.log(JSON.stringify({ teurc: r.teurc, cpcvNote: r.cpcvNote, advancePool: r.advancePool }, null, 2));

// §7.4 step 7: TypeScript bindings into packages/contracts-ts
const ids: Record<string, string> = { teurc: r.teurc, cpcv_note: r.cpcvNote, advance_pool: r.advancePool };
for (const n of names) {
  try {
    execFileSync(
      "stellar",
      ["contract", "bindings", "typescript", "--contract-id", ids[n], "--output-dir", path.join(root, "packages", "contracts-ts", n), "--network", "testnet", "--overwrite"],
      { stdio: "pipe" },
    );
    console.log(`bindings: packages/contracts-ts/${n}`);
  } catch (e) {
    console.warn(`bindings for ${n} failed (non-fatal):`, e instanceof Error ? e.message.split("\n")[0] : e);
  }
}
await db.$disconnect();
// snarkjs / circomlibjs keep worker threads alive after proving; exit explicitly.
process.exit(0);
