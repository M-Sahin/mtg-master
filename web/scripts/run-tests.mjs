#!/usr/bin/env node
// Bundles tests/*.test.ts with esbuild and runs them with node:test (no extra test framework).
import { readdirSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  esbuild = require(process.env.ESBUILD_PATH || "/opt/npm-tools/node_modules/esbuild");
}

const out = join(root, ".test-build");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tests = readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.ts"));
await esbuild.build({
  entryPoints: tests.map((t) => join(root, "tests", t)),
  outdir: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: "inline",
  logLevel: "warning",
});
const files = tests.map((t) => join(out, t.replace(/\.ts$/, ".js")));
const r = spawnSync(process.execPath, ["--test", "--enable-source-maps", ...files], { stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
process.exit(r.status ?? 1);
