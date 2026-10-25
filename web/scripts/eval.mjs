#!/usr/bin/env node
// Bundles evals/run.ts with esbuild and runs it (see evals/run.ts for options).
//   node scripts/eval.mjs check
//   ANTHROPIC_API_KEY=sk-ant-… node scripts/eval.mjs run --variants v1,v2 --hands 6
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const out = join(root, ".test-build", "eval.mjs");
mkdirSync(dirname(out), { recursive: true });
await esbuild.build({ entryPoints: [join(root, "evals", "run.ts")], bundle: true, platform: "node", format: "esm", target: "node20", outfile: out, logLevel: "warning" });
process.env.EVAL_DIR ??= join(root, "evals");
await import(pathToFileURL(out).href);
