/**
 * Caption Refiner using LangChain
 * Refines YouTube transcript segments using LLM batch processing
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

// ============================================================================
// Configuration
// ============================================================================

const REFINER_CONFIG = {
  MAX_SEGMENTS_PER_CHUNK: 50,
  CHUNK_SENTINEL: "<<<__CHUNK_END__>>>",
  MODEL: "google/gemini-2.5-flash-lite-preview-09-2025",
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Chunk segments into groups of at most max_segments_per_chunk segments
 * @param {Array} segments - Array of transcript segments
 * @param {number} maxSegmentsPerChunk - Maximum segments per chunk
 * @returns {Array<[number, number]>} List of (start_idx, end_idx) ranges where end_idx is exclusive
 */
function chunkSegmentsByCount(segments, maxSegmentsPerChunk) {
  const ranges = [];
  const n = segments.length;
  let start = 0;

  while (start < n) {
    const end = Math.min(start + maxSegmentsPerChunk, n);
    ranges.push([start, end]);
    start = end;
  }

  return ranges;
}

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

/**
 * Extract text from a line, removing timestamp if present
 */
function normalizeLineToText(line) {
  const normalized = line.split(/\s+/).join(" ");
  const match = normalized.match(/\[([^\]]+)\]\s*(.*)/);
  return match ? match[2].trim() : normalized.trim();
}

/**
 * Compute similarity score between two text lines
 * Uses character-level similarity and token-level Jaccard similarity
 */
function computeLineSimilarity(a, b) {
  if (!a || !b) {
    return 0.0;
  }

  // Character-level similarity using SequenceMatcher-like approach
  const charRatio = calculateStringSimilarity(a, b);

  // Token-level Jaccard similarity
  const aTokens = new Set(
    a.toLowerCase().match(/[A-Za-z0-9']+/g) || []
  );
  const bTokens = new Set(
    b.toLowerCase().match(/[A-Za-z0-9']+/g) || []
  );

  const intersection = new Set([...aTokens].filter((x) => bTokens.has(x)));
  const union = new Set([...aTokens, ...bTokens]);
  const jacc = union.size > 0 ? intersection.size / union.size : 0.0;

  return 0.7 * charRatio + 0.3 * jacc;
}

/**
 * Calculate string similarity (simplified SequenceMatcher)
 */
function calculateStringSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB);

  if (maxLen === 0) return 1.0;

  // Simple longest common subsequence approximation
  let matches = 0;
  const minLen = Math.min(lenA, lenB);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }

  return matches / maxLen;
}

/**
 * Align original segments to refined texts using dynamic programming
 */
function dpAlignSegments(
  origSegments,
  refTexts,
  applyTailGuard = false
) {
  const _GAP_PENALTY = -0.3;
  const _TAIL_GUARD_SIZE = 5;
  const _LENGTH_TOLERANCE = 0.1;

  const nOrig = origSegments.length;
  const nRef = refTexts.length;

  if (nOrig === 0) {
    return [];
  }

  // Initialize DP matrices
  const dp = Array(nOrig + 1)
    .fill(null)
    .map(() => Array(nRef + 1).fill(-Infinity));
  const back = Array(nOrig + 1)
    .fill(null)
    .map(() => Array(nRef + 1).fill(null));

  dp[0][0] = 0.0;

  // Initialize boundaries
  for (let i = 1; i <= nOrig; i++) {
    dp[i][0] = dp[i - 1][0] + _GAP_PENALTY;
    back[i][0] = "O";
  }

  for (let j = 1; j <= nRef; j++) {
    dp[0][j] = dp[0][j - 1] + _GAP_PENALTY;
    back[0][j] = "R";
  }

  // Fill DP table
  for (let i = 1; i <= nOrig; i++) {
    const origText = origSegments[i - 1].text || "";
    for (let j = 1; j <= nRef; j++) {
      const refText = refTexts[j - 1] || "";

      // Match score
      const matchScore =
        dp[i - 1][j - 1] + computeLineSimilarity(origText, refText);
      let bestScore = matchScore;
      let bestPtr = "M";

      // Gap in original
      const oScore = dp[i - 1][j] + _GAP_PENALTY;
      if (oScore > bestScore) {
        bestScore = oScore;
        bestPtr = "O";
      }

      // Gap in refined
      const rScore = dp[i][j - 1] + _GAP_PENALTY;
      if (rScore > bestScore) {
        bestScore = rScore;
        bestPtr = "R";
      }

      dp[i][j] = bestScore;
      back[i][j] = bestPtr;
    }
  }

  // Backtrack to build mapping
  const mapping = Array(nOrig).fill(null);
  let i = nOrig;
  let j = nRef;

  while (i > 0 || j > 0) {
    const ptr = i >= 0 && j >= 0 ? back[i][j] : null;

    if (ptr === "M" && i > 0 && j > 0) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (ptr === "O" && i > 0) {
      mapping[i - 1] = null;
      i--;
    } else if (ptr === "R" && j > 0) {
      j--;
    } else {
      if (i > 0) {
        mapping[i - 1] = null;
        i--;
      } else if (j > 0) {
        j--;
      } else {
        break;
      }
    }
  }

  // Build refined segments with optional tail guard
  const refinedSegments = [];
  const tailStart = applyTailGuard
    ? nOrig - _TAIL_GUARD_SIZE
    : nOrig + 1;

  for (let idx = 0; idx < origSegments.length; idx++) {
    const origSeg = origSegments[idx];
    const refIdx = mapping[idx];

    // Get refined text or fall back to original
    let textCandidate;
    if (refIdx !== null && refIdx >= 0 && refIdx < nRef) {
      textCandidate = refTexts[refIdx];
    } else {
      textCandidate = origSeg.text;
    }

    // Apply tail guard
    if (idx >= tailStart && textCandidate) {
      const origLen = origSeg.text?.length || 1;
      if (
        Math.abs(textCandidate.length - origLen) / origLen >
        _LENGTH_TOLERANCE
      ) {
        textCandidate = origSeg.text;
      }
    }

    // Final fallback to original if empty
    if (!textCandidate) {
      textCandidate = origSeg.text;
    }

    refinedSegments.push({
      text: textCandidate,
      startMs: origSeg.startMs,
      endMs: origSeg.endMs,
      startTimeText: origSeg.startTimeText,
    });
  }

  return refinedSegments;
}

/**
 * Parse refined transcript back into segments, preserving original timestamps
 * Uses per-chunk alignment with sentinels if available, otherwise global alignment
 */
function parseRefinedTranscript(refinedText, originalSegments) {
  if (!refinedText) {
    return [];
  }

  function parseWithChunks() {
    // Split refined text into chunk blocks by sentinel lines
    const rawBlocks = refinedText.split(REFINER_CONFIG.CHUNK_SENTINEL);

    // Compute original chunk ranges identically to generation
    const ranges = chunkSegmentsByCount(
      originalSegments,
      REFINER_CONFIG.MAX_SEGMENTS_PER_CHUNK
    );

    // Pad missing blocks as empty to trigger original fallbacks
    while (rawBlocks.length < ranges.length) {
      rawBlocks.push("");
    }

    // Build per-chunk alignment with tail guard enabled
    const finalSegments = [];
    for (let i = 0; i < ranges.length; i++) {
      const [startIdx, endIdx] = ranges[i];
      const blockText = rawBlocks[i] || "";
      const origChunk = originalSegments.slice(startIdx, endIdx);

      // Normalize block to text-only lines
      const lines = blockText
        .trim()
        .split("\n")
        .filter((x) => x)
        .map((x) => x.split(/\s+/).join(" "));
      const refinedTextsChunk = lines
        .map((ln) => normalizeLineToText(ln))
        .filter((t) => t);

      // Debug if mismatch
      if (refinedTextsChunk.length !== origChunk.length) {
        console.warn(
          `Parser chunk warning: expected ${origChunk.length} lines, got ${refinedTextsChunk.length}`
        );
      }

      // Align with tail guard for robustness at chunk ends
      finalSegments.push(
        ...dpAlignSegments(origChunk, refinedTextsChunk, true)
      );
    }

    return finalSegments;
  }

  function parseGlobal() {
    // Extract text from each line
    const refinedTexts = refinedText
      .trim()
      .split("\n")
      .map((line) => normalizeLineToText(line))
      .filter((t) => t);

    // Log parsing details for debugging
    if (refinedTexts.length !== originalSegments.length) {
      console.warn(
        `Parser warning: Expected ${originalSegments.length} lines, got ${refinedTexts.length} lines`
      );
    }

    // Global DP alignment with tail guard disabled (no chunk boundaries)
    return dpAlignSegments(originalSegments, refinedTexts, false);
  }

  // Route to appropriate parser
  if (refinedText.includes(REFINER_CONFIG.CHUNK_SENTINEL)) {
    return parseWithChunks();
  } else {
    return parseGlobal();
  }
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

  // Parse refined text back into segments
  const refinedSegments = parseRefinedTranscript(refinedText, segments);

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

