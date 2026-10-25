// Copies what pnpm installed for some dependencies of a workspace project (the
// packages and every transitive dependency, at the pnpm-lock.yaml versions)
// into another tree with pnpm's layout, so it can be laid over the Next.js
// standalone output, which keeps that layout too.
//
// deploy/Dockerfile uses it for the Prisma CLI and dotenv (prisma.config.ts
// imports it): the container runs `prisma migrate deploy` before the server,
// but the CLI is a devDependency that the standalone trace never includes.
// Copying the builder's install, instead of `npm install prisma` in the image,
// keeps the whole CLI tree on the lockfile and needs no network.
//
// usage: node deploy/copy-pnpm-closure.mjs [--exclude=a,b] <workspace root> <project dir> <out dir> <package>...
//   e.g. node deploy/copy-pnpm-closure.mjs /app apps/web /out prisma dotenv
// writes <out>/node_modules/.pnpm/<id>/ for every package of the closure (with
// pnpm's relative symlinks), the matching hoisted links in
// <out>/node_modules/.pnpm/node_modules/, and <out>/<project>/node_modules/<package>.
// --exclude leaves out dependencies by name, with everything only they pull in;
// their links stay behind dangling, so only code that imports them fails.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const excludeArg = args.find((a) => a.startsWith("--exclude="));
const exclude = new Set(excludeArg ? excludeArg.slice("--exclude=".length).split(",").filter(Boolean) : []);
const [root, project, out, ...packages] = args.filter((a) => a !== excludeArg);
if (!root || !project || !out || packages.length === 0) {
  console.error("usage: node deploy/copy-pnpm-closure.mjs [--exclude=a,b] <workspace root> <project dir> <out dir> <package>...");
  process.exit(2);
}

const store = path.join(realpathSync(root), "node_modules", ".pnpm");

/** `<store>/<id>`: the virtual-store entry holding a package's real directory (null outside the store, e.g. a workspace package). */
function entryOf(realDir) {
  const rel = path.relative(store, realDir);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return path.join(store, rel.split(path.sep)[0]);
}

/** Every `node_modules/<name>` and `node_modules/@scope/<name>` path directly under `dir`. */
function children(dir) {
  if (!existsSync(dir)) return [];
  const paths = [];
  for (const name of readdirSync(dir)) {
    if (name === ".bin" || name === "node_modules") continue;
    const p = path.join(dir, name);
    if (name.startsWith("@") && !lstatSync(p).isSymbolicLink()) {
      for (const sub of readdirSync(p)) paths.push(path.join(p, sub));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

/** The real path behind a link, or null when it dangles (an optional dependency for another platform). */
function resolve(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

// Walk the closure: an entry's node_modules holds the package itself plus a
// link to each dependency pnpm resolved for it (regular, optional and peer).
const entries = new Set();
const queue = packages.map((pkg) => {
  const real = resolve(path.join(root, project, "node_modules", pkg));
  const entry = real && entryOf(real);
  if (!entry) throw new Error(`${pkg} is not installed from the pnpm store in ${path.join(root, project)}`);
  return entry;
});
while (queue.length > 0) {
  const entry = queue.pop();
  if (entries.has(entry)) continue;
  entries.add(entry);
  const nodeModules = path.join(entry, "node_modules");
  for (const dep of children(nodeModules)) {
    if (exclude.has(path.relative(nodeModules, dep).split(path.sep).join("/"))) continue;
    const real = resolve(dep);
    const depEntry = real && entryOf(real);
    if (!depEntry) {
      if (real) throw new Error(`${dep} links outside the pnpm store (${real}); copy it explicitly`);
      continue;
    }
    queue.push(depEntry);
  }
}

const outStore = path.join(out, "node_modules", ".pnpm");
for (const entry of entries) {
  // verbatimSymlinks: keep pnpm's relative links as they are (cpSync would otherwise point them back at <root>).
  cpSync(entry, path.join(outStore, path.basename(entry)), { recursive: true, verbatimSymlinks: true });
}

// pnpm also links every package into <store>/node_modules, where Node finds the
// dependencies a package uses without declaring them. Keep those for the closure.
let hoisted = 0;
for (const link of children(path.join(store, "node_modules"))) {
  const real = resolve(link);
  if (!real || !entries.has(entryOf(real))) continue; // dangling, outside the store, or not in the closure
  const target = path.join(outStore, path.relative(store, link));
  if (existsSync(target)) continue;
  mkdirSync(path.dirname(target), { recursive: true });
  symlinkSync(readlinkSync(link), target);
  hoisted++;
}

for (const pkg of packages) {
  const real = realpathSync(path.join(root, project, "node_modules", pkg));
  const link = path.join(out, project, "node_modules", pkg);
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(path.relative(path.dirname(link), path.join(outStore, path.relative(store, real))), link);
}

const excluded = exclude.size > 0 ? `, without ${[...exclude].join(", ")}` : "";
console.log(`copy-pnpm-closure: ${packages.join(", ")} -> ${entries.size} packages (${hoisted} hoisted links${excluded}) in ${out}`);
