/**
 * Build script for bundling extension files
 * Uses esbuild to create bundled versions for Chrome extension
 */

import * as esbuild from "esbuild";
import { existsSync } from "fs";

const isWatch = process.argv.includes("--watch");

// Source files
const SOURCE_FILES = {
  background: "src/background.js",
  content: "src/content.js",
  popup: "src/popup.js",
};

// Output directory
const OUTPUT_DIR = "dist";

// Verify source files exist
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
  
  console.log("✅ Source files verified");
}

verifySourceFiles();

// Main build options
const buildOptions = {
  entryPoints: [SOURCE_FILES.background, SOURCE_FILES.content, SOURCE_FILES.popup],
  bundle: true,
  format: "iife", // Standard for extension scripts
  outdir: OUTPUT_DIR,
  entryNames: "[name].bundle", // Will produce background.bundle.js, etc.
  allowOverwrite: true,
  platform: "browser",
  target: "es2020",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  minify: !isWatch,
  sourcemap: !isWatch,
};

async function buildAll() {
  console.log(`\n🔨 Building extension bundles...`);
  
  await esbuild.build(buildOptions);
  
  console.log(`✅ Built background.bundle.js`);
  console.log(`✅ Built content.bundle.js`);
  console.log(`✅ Built popup.bundle.js`);
  console.log(`\n📦 Bundles written to ${OUTPUT_DIR}/`);
}

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log(`\n👀 Watching for changes...`);
} else {
  await buildAll();
}
