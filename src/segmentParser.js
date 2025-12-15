/**
 * Segment Parser Module
 * Advanced transcript segment alignment using dynamic programming
 * 
 * This module handles the complex task of aligning refined transcript text
 * back to original segments while preserving timestamps. Uses a DP algorithm
 * similar to sequence alignment to handle edge cases like merged/split lines.
 */

const SEGMENT_PARSER_CONFIG = {
  GAP_PENALTY: -0.30,
  TAIL_GUARD_SIZE: 5,
  LENGTH_TOLERANCE: 0.10,
};

/**
 * Compute character-level similarity ratio
 */
function computeCharSimilarity(a, b) {
  const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
  if (!longer.length) return 1.0;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

/**
 * Compute token-level Jaccard similarity
 */
function computeTokenSimilarity(a, b) {
  const aTokens = new Set(a.toLowerCase().match(/[a-z0-9']+/gi) || []);
  const bTokens = new Set(b.toLowerCase().match(/[a-z0-9']+/gi) || []);
  const intersection = new Set([...aTokens].filter(x => bTokens.has(x)));
  const union = new Set([...aTokens, ...bTokens]);
  return union.size ? intersection.size / union.size : 0.0;
}

/**
 * Compute similarity between two text strings
 * Uses character-level (70%) and token-level (30%) similarity
 */
function computeLineSimilarity(a, b) {
  if (!a || !b) return 0.0;
  return 0.7 * computeCharSimilarity(a, b) + 0.3 * computeTokenSimilarity(a, b);
}

/**
 * Normalize line to extract text only (remove timestamps)
 * Handles format: [timestamp] text
 */
function normalizeLineToText(line) {
  const normalized = line.split(/\s+/).join(" ").trim();
  const timestampMatch = normalized.match(/^\[([^\]]+)\]\s*(.*)$/);
  return timestampMatch ? timestampMatch[2].trim() : normalized;
}

/**
 * Align original segments to refined texts using dynamic programming
 * 
 * This is the core alignment algorithm that uses DP similar to sequence
 * alignment (like Smith-Waterman or Needleman-Wunsch) to find the best
 * mapping between original and refined segments.
 * 
 * @param {Array<Object>} origSegments - Original segments with timestamps
 * @param {Array<string>} refTexts - Refined text lines
 * @param {boolean} applyTailGuard - Whether to apply tail guard protection
 * @returns {Array<Object>} Aligned segments with refined text
 */
function dpAlignSegments(origSegments, refTexts, applyTailGuard = false) {
  const nOrig = origSegments.length;
  const nRef = refTexts.length;

  if (nOrig === 0) return [];

  const { GAP_PENALTY, TAIL_GUARD_SIZE, LENGTH_TOLERANCE } = SEGMENT_PARSER_CONFIG;

  // Initialize DP matrices
  // dp[i][j] = best score for aligning first i original segments to first j refined texts
  const dp = Array(nOrig + 1).fill(null).map(() => 
    Array(nRef + 1).fill(-Infinity)
  );
  
  // back[i][j] = pointer for backtracking: "M" (match), "O" (orig gap), "R" (refined gap)
  const back = Array(nOrig + 1).fill(null).map(() => 
    Array(nRef + 1).fill(null)
  );

  // Base case: empty alignment
  dp[0][0] = 0.0;

  // Initialize boundaries (gaps at start)
  for (let i = 1; i <= nOrig; i++) {
    dp[i][0] = dp[i - 1][0] + GAP_PENALTY;
    back[i][0] = "O";
  }

  for (let j = 1; j <= nRef; j++) {
    dp[0][j] = dp[0][j - 1] + GAP_PENALTY;
    back[0][j] = "R";
  }

  // Fill DP table
  for (let i = 1; i <= nOrig; i++) {
    const origText = origSegments[i - 1].text;
    
    for (let j = 1; j <= nRef; j++) {
      const refText = refTexts[j - 1];

      // Option 1: Match current original with current refined
      let bestScore = dp[i - 1][j - 1] + computeLineSimilarity(origText, refText);
      let bestPtr = "M";

      // Option 2: Gap in original (skip original segment)
      const oScore = dp[i - 1][j] + GAP_PENALTY;
      if (oScore > bestScore) {
        bestScore = oScore;
        bestPtr = "O";
      }

      // Option 3: Gap in refined (skip refined text)
      const rScore = dp[i][j - 1] + GAP_PENALTY;
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
  let i = nOrig, j = nRef;

  while (i > 0 || j > 0) {
    const ptr = (i >= 0 && j >= 0) ? back[i][j] : null;

    if (ptr === "M" && i > 0 && j > 0) {
      // Match: map original[i-1] to refined[j-1]
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (ptr === "O" && i > 0) {
      // Gap in original: skip original segment (use original text)
      mapping[i - 1] = null;
      i--;
    } else if (ptr === "R" && j > 0) {
      // Gap in refined: skip refined text
      j--;
    } else {
      // Fallback for edge cases
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
  const tailStart = applyTailGuard ? nOrig - TAIL_GUARD_SIZE : nOrig + 1;

  for (let idx = 0; idx < nOrig; idx++) {
    const origSeg = origSegments[idx];
    const refIdx = mapping[idx];

    // Get refined text or fall back to original
    let textCandidate = (refIdx !== null && refIdx >= 0 && refIdx < nRef)
      ? refTexts[refIdx]
      : origSeg.text;

    // Apply tail guard: check if we're in the tail region
    // If refined text length differs by more than tolerance, revert to original
    if (idx >= tailStart && textCandidate) {
      const origLen = origSeg.text.length || 1;
      if (Math.abs(textCandidate.length - origLen) / origLen > LENGTH_TOLERANCE) {
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
 * Chunk segments into groups by count
 * 
 * @param {Array<Object>} segments - Segments to chunk
 * @param {number} maxPerChunk - Max segments per chunk
 * @returns {Array<[number, number]>} Array of [startIdx, endIdx] ranges
 */
function chunkSegmentsByCount(segments, maxPerChunk) {
  const ranges = [];
  const n = segments.length;
  let start = 0;

  while (start < n) {
    const end = Math.min(start + maxPerChunk, n);
    ranges.push([start, end]);
    start = end;
  }

  return ranges;
}

/**
 * Parse refined text with chunk sentinels
 * Processes each chunk independently to prevent error propagation
 * 
 * @param {string} refinedText - Refined text with sentinels
 * @param {Array<Object>} originalSegments - Original segments
 * @param {string} chunkSentinel - Sentinel marker between chunks
 * @param {number} maxSegmentsPerChunk - Segments per chunk
 * @returns {Array<Object>} Parsed segments
 */
function parseWithChunks(refinedText, originalSegments, chunkSentinel, maxSegmentsPerChunk) {
  // Split by sentinel
  let rawBlocks = refinedText.split(chunkSentinel);

  // Compute chunk ranges (same as used during generation)
  const ranges = chunkSegmentsByCount(originalSegments, maxSegmentsPerChunk);

  // Pad missing blocks with empty strings
  while (rawBlocks.length < ranges.length) {
    rawBlocks.push("");
  }

  // Build per-chunk alignment with tail guard enabled
  const finalSegments = [];

  for (let i = 0; i < ranges.length; i++) {
    const [startIdx, endIdx] = ranges[i];
    const blockText = rawBlocks[i];
    const origChunk = originalSegments.slice(startIdx, endIdx);

    // Normalize block to text-only lines
    const lines = blockText.trim().split('\n')
      .filter(x => x.trim())
      .map(x => x.split(/\s+/).join(' '));
    
    const refinedTextsChunk = lines
      .map(normalizeLineToText)
      .filter(t => t);

    // Debug if mismatch
    if (refinedTextsChunk.length !== origChunk.length) {
      console.warn(
        `Parser chunk ${i + 1}/${ranges.length} warning: ` +
        `expected ${origChunk.length} lines, got ${refinedTextsChunk.length}`
      );
    }

    // Align with tail guard for robustness at chunk ends
    const aligned = dpAlignSegments(origChunk, refinedTextsChunk, true);
    finalSegments.push(...aligned);
  }

  return finalSegments;
}

/**
 * Parse refined text without sentinels (global alignment)
 * Fallback for when chunking wasn't used
 * 
 * @param {string} refinedText - Refined text
 * @param {Array<Object>} originalSegments - Original segments
 * @returns {Array<Object>} Parsed segments
 */
function parseGlobal(refinedText, originalSegments) {
  // Extract text from each line
  const refinedTexts = refinedText.trim().split('\n')
    .map(normalizeLineToText);

  // Log if mismatch
  if (refinedTexts.length !== originalSegments.length) {
    console.warn(
      `Parser warning: Expected ${originalSegments.length} lines, ` +
      `got ${refinedTexts.length} lines`
    );
  }

  // Global DP alignment without tail guard (no chunk boundaries)
  return dpAlignSegments(originalSegments, refinedTexts, false);
}

/**
 * Parse refined transcript back into segments with timestamps
 * 
 * Main entry point for the segment parser. Handles both chunked
 * and non-chunked refined text.
 * 
 * @param {string} refinedText - Refined text from LLM
 * @param {Array<Object>} originalSegments - Original segments with timestamps
 * @param {string} chunkSentinel - Sentinel marker between chunks
 * @param {number} maxSegmentsPerChunk - Segments per chunk (for chunked parsing)
 * @returns {Array<Object>} Parsed segments with timestamps preserved
 */
function parseRefinedSegments(refinedText, originalSegments, chunkSentinel, maxSegmentsPerChunk) {
  if (!refinedText) return [];

  // Route to appropriate parser based on presence of sentinels
  if (refinedText.includes(chunkSentinel)) {
    return parseWithChunks(refinedText, originalSegments, chunkSentinel, maxSegmentsPerChunk);
  } else {
    return parseGlobal(refinedText, originalSegments);
  }
}

// ES module exports
export { chunkSegmentsByCount, parseRefinedSegments };

