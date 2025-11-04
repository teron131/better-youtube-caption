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
  entryPoints: ["src/captionSummarizer.js", "src/captionRefiner.js"],
  bundle: true,
  format: "iife",
  outdir: "dist",
  entryNames: "[name].bundle",
  allowOverwrite: true,
  platform: "browser", // Chrome extension service worker
  target: "es2020",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: !isWatch,
  sourcemap: !isWatch,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Built dist/captionSummarizer.bundle.js and dist/captionRefiner.bundle.js");
}

