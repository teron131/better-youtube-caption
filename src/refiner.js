/**
 * Transcript Refinement Module
 * Refines YouTube transcripts using LLM
 * Uses segmentParser.js for robust alignment
 */

// Configuration constants
const REFINER_CONFIG = {
  MODEL: "google/gemini-2.5-flash-lite",
  MAX_SEGMENTS_PER_CHUNK: 100,
  CHUNK_SENTINEL: "<<<__CHUNK_END__>>>",
};

/**
 * Refine transcript using OpenRouter API
 * 
 * @param {Array<Object>} transcript - Original transcript segments
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} apiKey - OpenRouter API key
 * @param {Function} onProgress - Progress callback (chunkIdx, totalChunks)
 * @returns {Promise<Array<Object>>} Refined segments
 */
async function refineTranscriptWithLLM(transcript, title, description, apiKey, onProgress = null) {
  if (!transcript || transcript.length === 0) {
    throw new Error("No transcript segments provided");
  }

  const { MODEL, MAX_SEGMENTS_PER_CHUNK, CHUNK_SENTINEL } = REFINER_CONFIG;

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

  // User preamble function
  const userPreamble = `Video Title: ${title || ''}
Video Description: ${description || ''}

Transcript Chunk:`;

  // Chunk segments using the shared function from segmentParser.js
  const ranges = chunkSegmentsByCount(transcript, MAX_SEGMENTS_PER_CHUNK);

  console.log(`Processing ${ranges.length} chunks...`);

  // Process chunks sequentially (browser can't handle parallel well)
  const allRefinedLines = [];

  for (let chunkIdx = 0; chunkIdx < ranges.length; chunkIdx++) {
    const [startIdx, endIdx] = ranges[chunkIdx];
    const chunkSegments = transcript.slice(startIdx, endIdx);
    const expectedLineCount = chunkSegments.length;

    // Format chunk text
    const chunkTextOnly = chunkSegments
      .map(seg => (seg.text || '').split(/\s+/).join(' '))
      .join('\n');

    // Progress callback
    if (onProgress) {
      onProgress(chunkIdx + 1, ranges.length);
    }

    // Call OpenRouter API with reasoning parameters matching Python implementation
    const response = await fetch(API_ENDPOINTS.OPENROUTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'Better YouTube Caption',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${userPreamble}\n${chunkTextOnly}` },
        ],
        temperature: 0,
        reasoning: { effort: 'low' },
        include_reasoning: false,
        provider: { sort: 'throughput' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const refinedText = data.choices[0].message.content;
    const refinedLines = refinedText.trim().split('\n');
    const actualLineCount = refinedLines.length;

    console.log(
      `Chunk ${chunkIdx + 1}/${ranges.length}: ` +
      `received ${actualLineCount} lines (expected ${expectedLineCount})`
    );

    if (actualLineCount !== expectedLineCount) {
      console.warn(`⚠️ Line count mismatch in chunk ${chunkIdx + 1}!`);
    }

    allRefinedLines.push(...refinedLines);
    allRefinedLines.push(CHUNK_SENTINEL);
  }

  // Join all refined lines
  const refinedText = allRefinedLines.join('\n');

  // Parse back into segments using segmentParser.js
  const refinedSegments = parseRefinedSegments(
    refinedText,
    transcript,
    CHUNK_SENTINEL,
    MAX_SEGMENTS_PER_CHUNK
  );

  console.log(`Refinement complete: ${refinedSegments.length} segments`);

  return refinedSegments;
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    refineTranscriptWithLLM,
    REFINER_CONFIG,
  };
}
