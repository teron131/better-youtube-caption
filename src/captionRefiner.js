/**
 * Caption Refiner using LangChain
 * Refines YouTube transcript segments using LLM batch processing
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { DEFAULTS, REFINER_CONFIG } from "./constants.js";
import { chunkSegmentsByCount, parseRefinedSegments } from "./segmentParser.js";
import { getExtensionUrl } from "./utils/contextValidation.js";

// ============================================================================
// Constants
// ============================================================================

const SYSTEM_PROMPT = `You are correcting segments of a YouTube video transcript. These segments could be from anywhere in the video (beginning, middle, or end). Use the video title and description for context.

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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize segment text (remove internal newlines, join with spaces)
 */
function normalizeSegmentText(text) {
  return (text || "").split(/\s+/).join(" ");
}

/**
 * Format transcript segments as newline-separated text
 */
function formatTranscriptSegments(segments) {
  return segments
    .map(seg => {
      const normalizedText = normalizeSegmentText(seg.text);
      const timestamp = seg.startTimeText || "";
      return `[${timestamp}] ${normalizedText}`;
    })
    .join("\n");
}

/**
 * Build user preamble with video metadata
 */
function buildUserPreamble(title, description) {
  return [
    `Video Title: ${title || ""}`,
    `Video Description: ${description || ""}`,
    "",
    "Transcript Chunk:",
  ].join("\n");
}

// ============================================================================
// Main Refinement Function
// ============================================================================

/**
 * Create LLM instance
 */
function createLLM(apiKey, model) {
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": getExtensionUrl(),
        "X-Title": "Better YouTube Caption",
      },
    },
    temperature: 0,
    reasoning: { effort: "minimal" },
    extra_body: {
      provider: { sort: "throughput" },
    },
  });
}

/**
 * Extract text from LLM response
 */
function extractResponseText(response) {
  const content = response?.content;
  if (typeof content === "string") return content;

  // LangChain can represent multimodal content as an array of parts.
  // We only care about any text parts and concatenate them.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        return part.text || "";
      })
      .join("");
  }

  return content != null ? String(content) : "";
}

/**
 * Refine video transcript using LLM inference
 * @param {Array} segments - Array of transcript segments with {text, startMs, endMs, startTimeText}
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} apiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional progress callback (chunkIdx, totalChunks)
 * @param {string} model - Optional model name (defaults to DEFAULTS.MODEL_REFINER)
 * @returns {Promise<Array>} Refined segments with same structure as input
 */
export async function refineTranscriptWithLLM(
  segments,
  title,
  description,
  apiKey,
  progressCallback = null,
  model = DEFAULTS.MODEL_REFINER
) {
  if (!segments || segments.length === 0) {
    return [];
  }

  const llm = createLLM(apiKey, model);
  const preambleText = buildUserPreamble(title, description);

  // Chunk segments and prepare messages
  const ranges = chunkSegmentsByCount(segments, REFINER_CONFIG.MAX_SEGMENTS_PER_CHUNK);
  const batchMessages = [];
  const chunkInfo = [];

  for (let chunkIdx = 0; chunkIdx < ranges.length; chunkIdx++) {
    const [startIdx, endIdx] = ranges[chunkIdx];
    const chunkSegments = segments.slice(startIdx, endIdx);
    const chunkTextOnly = chunkSegments
      .map(seg => normalizeSegmentText(seg.text))
      .join("\n");

    batchMessages.push([
      new SystemMessage({ content: SYSTEM_PROMPT }),
      new HumanMessage({ content: `${preambleText}\n${chunkTextOnly}` }),
    ]);

    chunkInfo.push({
      chunkIdx: chunkIdx + 1,
      expectedLineCount: chunkSegments.length,
    });
  }

  // Process all chunks in parallel
  if (progressCallback) {
    progressCallback(0, batchMessages.length);
  }

  const responses = await llm.batch(batchMessages);

  // Process responses and collect refined lines
  const allRefinedLines = [];
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const { chunkIdx, expectedLineCount } = chunkInfo[i];

    const refinedText = extractResponseText(response);
    const refinedLines = refinedText.trim().split("\n");

    if (progressCallback) {
      progressCallback(chunkIdx, batchMessages.length);
    }

    if (refinedLines.length !== expectedLineCount) {
      console.warn(
        `Line count mismatch in chunk ${chunkIdx}: expected ${expectedLineCount}, got ${refinedLines.length}`
      );
    }

    allRefinedLines.push(...refinedLines);
    allRefinedLines.push(REFINER_CONFIG.CHUNK_SENTINEL);
  }

  // Parse refined text back into segments
  const refinedText = allRefinedLines.join("\n");
  return parseRefinedSegments(
    refinedText,
    segments,
    REFINER_CONFIG.CHUNK_SENTINEL,
    REFINER_CONFIG.MAX_SEGMENTS_PER_CHUNK
  );
}
