/**
 * Build script for bundling LangChain/LangGraph dependencies
 * Uses esbuild to create bundled versions for Chrome extension
 * 
 * IMPORTANT: This script reads from src/ and writes to dist/
 * Source files in src/ are NEVER modified or overwritten.
 */

import * as esbuild from "esbuild";
import { existsSync } from "fs";

const isWatch = process.argv.includes("--watch");

// Source files (read-only - never modified)
const SOURCE_FILES = {
  summarizer: "src/captionSummarizer.js",
  refiner: "src/captionRefiner.js",
};

// Output directory (where bundles are written)
const OUTPUT_DIR = "dist";

// Verify source files exist before building
function verifySourceFiles() {
  const missing = [];
  for (const [name, path] of Object.entries(SOURCE_FILES)) {
    if (!existsSync(path)) {
      missing.push(`${name}: ${path}`);
    }
  }
  
  if (missing.length > 0) {
    console.error("❌ Error: Source files not found:");
    missing.forEach((file) => console.error(`   - ${file}`));
    process.exit(1);
  }
  
  console.log("✅ Source files verified:");
  Object.entries(SOURCE_FILES).forEach(([name, path]) => {
    console.log(`   - ${name}: ${path}`);
  });
}

// Verify source files before building
verifySourceFiles();

// Safety check: Ensure output directory is NOT in src/
if (OUTPUT_DIR.startsWith("src/") || OUTPUT_DIR === "src") {
  console.error(`❌ Error: Output directory '${OUTPUT_DIR}' cannot be in src/`);
  console.error("   This would risk overwriting source files!");
  process.exit(1);
}

const buildOptions = {
  entryPoints: [SOURCE_FILES.summarizer, SOURCE_FILES.refiner],
  bundle: true,
  format: "iife",
  outdir: OUTPUT_DIR,
  entryNames: "[name].bundle",
  allowOverwrite: true, // Only overwrites files in dist/, never src/
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
  console.log(`\n👀 Watching for changes in ${SOURCE_FILES.summarizer} and ${SOURCE_FILES.refiner}`);
  console.log(`📦 Bundles will be written to ${OUTPUT_DIR}/`);
  console.log("⚠️  Source files in src/ are never modified.\n");
} else {
  console.log(`\n🔨 Building bundles...`);
  await esbuild.build(buildOptions);
  console.log(`✅ Built ${OUTPUT_DIR}/captionSummarizer.bundle.js`);
  console.log(`✅ Built ${OUTPUT_DIR}/captionRefiner.bundle.js`);
  console.log(`\n💡 Source files in src/ remain unchanged.\n`);
}

