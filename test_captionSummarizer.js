/**
 * Test script for JavaScript summary workflow
 * Tests the LangGraph workflow with a YouTube video URL
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

// Import the workflow (using source, not bundle)
const workflowModule = await import("./src/captionSummarizer.js");

/**
 * Get transcript from Scrape Creators API
 */
async function getTranscriptFromScrapeCreators(youtubeUrl) {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    throw new Error("SCRAPECREATORS_API_KEY environment variable is required");
  }

  console.log(`🔗 Fetching transcript from Scrape Creators API...`);
  const startTime = Date.now();

  const url = `${global.API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(youtubeUrl)}&get_transcript=true`;
  const headers = { "x-api-key": apiKey };

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Scrape Creators API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const transcript = result.transcript_only_text || "";

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ Transcript fetched in ${elapsed}s (${transcript.length} characters)`);

  if (!transcript) {
    throw new Error("No transcript found in API response");
  }

  return transcript;
}

/**
 * Main test function
 */
async function main() {
  const testUrl = process.argv[2] || "https://youtu.be/pmdiKAE_GLs";
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  console.log("=".repeat(80));
  console.log("TEST: JavaScript Summary Workflow with LangGraph");
  console.log("=".repeat(80));
  console.log(`📹 Video URL: ${testUrl}`);
  console.log(`🤖 Using OpenRouter API\n`);

  try {
    // Step 1: Get transcript
    const transcript = await getTranscriptFromScrapeCreators(testUrl);

    // Step 2: Execute workflow
    console.log("\n" + "=".repeat(80));
    console.log("ANALYSIS & VERIFICATION WORKFLOW");
    console.log("=".repeat(80));

    const progressCallback = (message) => {
      console.log(message);
    };

    const startTime = Date.now();
    const result = await workflowModule.executeSummarizationWorkflow(
      {
        transcript: transcript,
        analysis_model: "x-ai/grok-4-fast",
        quality_model: "x-ai/grok-4-fast",
      },
      apiKey,
      progressCallback
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Step 3: Display results
    console.log("\n" + "=".repeat(80));
    console.log("RESULTS");
    console.log("=".repeat(80));
    console.log(`\n⏱️  Total time: ${elapsed}s`);
    console.log(`🔄 Iterations: ${result.iteration_count}`);
    console.log(`📈 Final quality score: ${result.quality_score}%`);
    console.log(`\n📝 Summary:`);
    console.log(result.summary_text);

    console.log("\n✅ Test completed successfully!");

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
main();

