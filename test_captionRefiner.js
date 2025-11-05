/**
 * Test script for JavaScript refiner workflow
 * Tests transcript refinement with LangChain batch processing
 */

import dotenv from "dotenv";
import fetch from "node-fetch";
import { dirname } from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock Chrome APIs for Node.js
global.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
  },
};

// Mock API_ENDPOINTS (normally from constants.js)
global.API_ENDPOINTS = {
  SCRAPE_CREATORS: "https://api.scrapecreators.com/v1/youtube/video",
  OPENROUTER: "https://openrouter.ai/api/v1/chat/completions",
};

// Import the refiner (using source)
const { refineTranscriptWithLLM } = await import("./src/captionRefiner.js");

/**
 * Get video data from Scrape Creators API
 */
async function getVideoDataFromScrapeCreators(youtubeUrl) {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    throw new Error("SCRAPECREATORS_API_KEY environment variable is required");
  }

  console.log(`🔗 Fetching video data from Scrape Creators API...`);
  const startTime = Date.now();

  const url = `${global.API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(youtubeUrl)}&get_transcript=true`;
  const headers = { "x-api-key": apiKey };

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Scrape Creators API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const title = data.title || "";
  const description = data.description || "";
  let transcript = [];
  if (data.transcript && Array.isArray(data.transcript)) {
    transcript = data.transcript.map(seg => ({
      text: seg.text || "",
      startMs: seg.startMs || "",
      endMs: seg.endMs || "",
      startTimeText: seg.startTimeText || "",
    }));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ Video data fetched in ${elapsed}s (${transcript.length} segments)`);

  if (!transcript.length) {
    throw new Error("No transcript segments found in API response");
  }

  return { title, description, transcript };
}

/**
 * Main test function
 */
async function main() {
  const testUrl = process.argv[2] || "https://www.youtube.com/watch?v=6N-vVluLGb4";
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;
  const scrapeApiKey = process.env.SCRAPECREATORS_API_KEY;

  if (!openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }
  if (!scrapeApiKey) {
    throw new Error("SCRAPECREATORS_API_KEY environment variable is required");
  }

  console.log("=".repeat(80));
  console.log("TEST: JavaScript Refiner Workflow with LangChain Batch");
  console.log("=".repeat(80));
  console.log(`📹 Video URL: ${testUrl}`);
  console.log(`🤖 Using OpenRouter API\n`);

  let originalSegments;
  try {
    // Step 1: Get video data
    const videoData = await getVideoDataFromScrapeCreators(testUrl);
    originalSegments = videoData.transcript;

    console.log("\n" + "=".repeat(80));
    console.log("VIDEO DATA");
    console.log("=".repeat(80));
    console.log(`Title: ${videoData.title}`);
    console.log(`Description length: ${videoData.description.length} chars`);
    console.log(`Transcript segments: ${originalSegments.length}`);

    // Step 2: Execute refinement workflow
    console.log("\n" + "=".repeat(80));
    console.log("REFINEMENT WORKFLOW");
    console.log("=".repeat(80));

    const progressCallback = (idx, total) => {
      console.log(`Progress: ${idx}/${total}`);
    };

    const startTime = Date.now();
    const refinedSegments = await refineTranscriptWithLLM(
      originalSegments,
      videoData.title,
      videoData.description,
      openrouterApiKey,
      progressCallback
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Step 3: Display results
    console.log("\n" + "=".repeat(80));
    console.log("RESULTS");
    console.log("=".repeat(80));
    console.log(`\n⏱️  Total time: ${elapsed}s`);
    console.log(`Original segments: ${originalSegments.length}`);
    console.log(`Refined segments: ${refinedSegments.length}`);
    console.log(`Segments match: ${originalSegments.length === refinedSegments.length}`);

    // Sample first 3 segments
    const numSamples = Math.min(3, originalSegments.length);
    console.log(`\nSample first ${numSamples} segments:`);
    for (let i = 0; i < numSamples; i++) {
      const orig = originalSegments[i];
      const ref = refinedSegments[i];
      const textChanged = orig.text !== ref.text;
      console.log(`\nSegment ${i + 1}:`);
      console.log(`  Original: [${orig.startTimeText}] ${orig.text}`);
      console.log(`  Refined:  [${ref.startTimeText}] ${ref.text}`);
      console.log(`  Text changed: ${textChanged}`);
      if (textChanged) {
        console.log(`    Original length: ${orig.text.length} chars`);
        console.log(`    Refined length:  ${ref.text.length} chars`);
        console.log(`    Length diff:     ${ref.text.length - orig.text.length} chars`);
      }
    }

    console.log("\n✅ Test completed successfully!");

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
main();
