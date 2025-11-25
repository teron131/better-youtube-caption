/**
 * Build script for bundling LangChain/LangGraph dependencies and OpenCC
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
  opencc: "src/utils/opencc.js",
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

// Build options for LangChain bundles
const langchainBuildOptions = {
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

// Build options for OpenCC bundle
const openccBuildOptions = {
  entryPoints: [SOURCE_FILES.opencc],
  bundle: true,
  format: "iife",
  outfile: `${OUTPUT_DIR}/opencc.bundle.js`,
  platform: "browser",
  target: "es2020",
  external: [], // Bundle everything
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: !isWatch,
  sourcemap: !isWatch,
};

async function buildAll() {
  console.log(`\n🔨 Building bundles...`);
  
  // Build LangChain bundles
  await esbuild.build(langchainBuildOptions);
  console.log(`✅ Built ${OUTPUT_DIR}/captionSummarizer.bundle.js`);
  console.log(`✅ Built ${OUTPUT_DIR}/captionRefiner.bundle.js`);
  
  // Build OpenCC bundle
  await esbuild.build(openccBuildOptions);
  console.log(`✅ Built ${OUTPUT_DIR}/opencc.bundle.js`);
  
  console.log(`\n💡 Source files in src/ remain unchanged.\n`);
}

if (isWatch) {
  const langchainCtx = await esbuild.context(langchainBuildOptions);
  const openccCtx = await esbuild.context(openccBuildOptions);
  
  await langchainCtx.watch();
  await openccCtx.watch();
  
  console.log(`\n👀 Watching for changes in:`);
  console.log(`   - ${SOURCE_FILES.summarizer}`);
  console.log(`   - ${SOURCE_FILES.refiner}`);
  console.log(`   - ${SOURCE_FILES.opencc}`);
  console.log(`📦 Bundles will be written to ${OUTPUT_DIR}/`);
  console.log("⚠️  Source files in src/ are never modified.\n");
} else {
  await buildAll();
}
