/**
 * Caption Refiner using LangChain
 * Refines YouTube transcript segments using LLM batch processing
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  chunkSegmentsByCount,
  parseRefinedSegments,
} from "./segmentParser.js";

// ============================================================================
// Configuration
// ============================================================================

const REFINER_CONFIG = {
  // Smaller batch size keeps individual requests lighter, reducing latency on slower models
  MAX_SEGMENTS_PER_CHUNK: 30,
  CHUNK_SENTINEL: "<<<__CHUNK_END__>>>",
  MODEL: "google/gemini-2.5-flash-lite-preview-09-2025",
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format transcript segments as newline-separated text
 * Removes internal newlines from each segment and joins with spaces
 */
function formatTranscriptSegments(segments) {
  return segments
    .map((seg) => {
      // Remove internal newlines and normalize whitespace
      const normalizedText = (seg.text || "").split(/\s+/).join(" ");
      const timestamp = seg.startTimeText || "";
      return `[${timestamp}] ${normalizedText}`;
    })
    .join("\n");
}

// ============================================================================
// Main Refinement Function
// ============================================================================

/**
 * Refine video transcript using LLM inference
 * @param {Array} segments - Array of transcript segments with {text, startMs, endMs, startTimeText}
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} apiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional progress callback (chunkIdx, totalChunks)
 * @param {string} model - Optional model name (defaults to REFINER_CONFIG.MODEL)
 * @returns {Promise<Array>} Refined segments with same structure as input
 */
async function refineTranscriptWithLLM(
  segments,
  title,
  description,
  apiKey,
  progressCallback = null,
  model = REFINER_CONFIG.MODEL
) {
  if (!segments || segments.length === 0) {
    return [];
  }

  // Setup LLM
  const refererUrl =
    typeof chrome !== "undefined" && chrome.runtime
      ? chrome.runtime.getURL("")
      : "https://github.com/better-youtube-caption";

  const llm = new ChatOpenAI({
    model: model,
    apiKey: apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": refererUrl,
        "X-Title": "Better YouTube Caption",
      },
    },
    temperature: 0,
    use_responses_api: true,
    reasoning: { effort: "minimal" },
    extra_body: {
      include_reasoning: false,
      provider: { sort: "throughput" },
    },
  });

  // System prompt
  const systemPrompt = `You are correcting segments of a YouTube video transcript. These segments could be from anywhere in the video (beginning, middle, or end). Use the video title and description for context.

CRITICAL CONSTRAINTS:
- Only fix typos and grammar. Do NOT change meaning or structure.
- PRESERVE ALL NEWLINES: each line is a distinct transcript segment.
- Do NOT add, remove, or merge lines. Keep the same number of lines.
- MAINTAIN SIMILAR LINE LENGTHS: Each output line should be approximately the same character count as its corresponding input line (±10% tolerance). Do NOT expand short lines into long paragraphs. Do NOT condense long lines significantly. Keep each line concise.
- If a sentence is broken across lines, keep it broken the same way.
- PRESERVE THE ORIGINAL LANGUAGE: output must be in the same language as the input transcript.
- Focus on minimal corrections: fix typos, correct grammar errors, but keep expansions/additions to an absolute minimum.

EXAMPLES OF CORRECT BEHAVIOR:

Input:
up to 900. From 900 up to 1,100.
If you sold at the reasonable
valuations, when the gains that already
been had, you missed out big time. I

Output:
up to $900. From $900 up to $1,100.
If you sold at the reasonable
valuations, when the gains that already
had been had, you missed out big time. I`;

  function userPreamble(title, description) {
    const parts = [
      `Video Title: ${title || ""}`,
      `Video Description: ${description || ""}`,
      "",
      "Transcript Chunk:",
    ];
    return parts.join("\n");
  }

  const preambleText = userPreamble(title, description);

  // Chunking by segment count
  const ranges = chunkSegmentsByCount(
    segments,
    REFINER_CONFIG.MAX_SEGMENTS_PER_CHUNK
  );

  // Prepare all messages for batch processing
  const batchMessages = [];
  const chunkInfo = [];

  for (let chunkIdx = 0; chunkIdx < ranges.length; chunkIdx++) {
    const [startIdx, endIdx] = ranges[chunkIdx];
    const chunkSegments = segments.slice(startIdx, endIdx);
    const expectedLineCount = chunkSegments.length;
    const chunkTextOnly = chunkSegments
      .map((seg) => (seg.text || "").split(/\s+/).join(" "))
      .join("\n");

    const messages = [
      new SystemMessage({ content: systemPrompt }),
      new HumanMessage({
        content: `${preambleText}\n${chunkTextOnly}`,
      }),
    ];

    batchMessages.push(messages);
    chunkInfo.push({
      chunkIdx: chunkIdx + 1,
      startIdx,
      endIdx,
      expectedLineCount,
    });
  }

  // Process all chunks in parallel using batch
  if (progressCallback) {
    progressCallback(0, batchMessages.length);
  }

  const responses = await llm.batch(batchMessages);

  // Process responses
  const allRefinedLines = [];
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const info = chunkInfo[i];
    const chunkIdx = info.chunkIdx;
    const expectedLineCount = info.expectedLineCount;

    // With use_responses_api, access content via content_blocks
    const refinedText =
      response.content_blocks && response.content_blocks.length > 0
        ? response.content_blocks[response.content_blocks.length - 1].text
        : response.content;
    const refinedLines = refinedText.trim().split("\n");
    const actualLineCount = refinedLines.length;

    if (progressCallback) {
      progressCallback(chunkIdx, batchMessages.length);
    }

    if (actualLineCount !== expectedLineCount) {
      console.warn(
        `WARNING: Line count mismatch in chunk ${chunkIdx}! Expected ${expectedLineCount}, got ${actualLineCount}`
      );
    }

    allRefinedLines.push(...refinedLines);
    // Insert a sentinel line to preserve chunk boundaries for the parser
    allRefinedLines.push(REFINER_CONFIG.CHUNK_SENTINEL);
  }

  const refinedText = allRefinedLines.join("\n");

  // Parse refined text back into segments using segmentParser
  const refinedSegments = parseRefinedSegments(
    refinedText,
    segments,
    REFINER_CONFIG.CHUNK_SENTINEL,
    REFINER_CONFIG.MAX_SEGMENTS_PER_CHUNK
  );

  return refinedSegments;
}

// Export for use in background.js (service worker context)
// In bundled version, this will be available as refineTranscriptWithLLM
if (typeof globalThis !== "undefined") {
  globalThis.refineTranscriptWithLLM = refineTranscriptWithLLM;
  globalThis.REFINER_CONFIG = REFINER_CONFIG;
}

// ES module exports for Node.js testing
export { REFINER_CONFIG, refineTranscriptWithLLM };
