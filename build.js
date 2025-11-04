/**
 * Build script for bundling LangChain/LangGraph dependencies
 * Uses esbuild to create bundled versions for Chrome extension
 */

import * as esbuild from "esbuild";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/summaryWorkflow.js"],
  bundle: true,
  format: "iife",
  globalName: "SummaryWorkflow",
  outfile: "src/summaryWorkflow.bundle.js",
  platform: "node", // Service workers can use Node.js APIs
  target: "es2020",
  // Mark Node.js built-ins as external (they're available in service worker context)
  external: ["node:async_hooks", "node:util", "node:events", "node:stream", "node:fs", "node:path", "node:url"],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: !isWatch,
  sourcemap: !isWatch,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("✓ Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("✓ Built src/summaryWorkflow.bundle.js");
}

