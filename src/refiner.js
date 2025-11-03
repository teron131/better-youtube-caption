/**
 * Transcript Refinement Module
 * Refines YouTube transcripts using LLM with parallel batch processing
 */

const REFINER_CONFIG = {
  MODEL: "google/gemini-2.5-flash-lite",
  MAX_SEGMENTS_PER_CHUNK: 50,
  CHUNK_SENTINEL: "<<<__CHUNK_END__>>>",
};

/**
 * Refine transcript using OpenRouter API with parallel batch processing
 * 
 * @param {Array<Object>} transcript - Original transcript segments
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} apiKey - OpenRouter API key
 * @param {Function} onProgress - Progress callback (chunkIdx, totalChunks)
 * @returns {Promise<Array<Object>>} Refined segments with preserved timestamps
 */
async function refineTranscriptWithLLM(transcript, title, description, apiKey, onProgress = null) {
  if (!transcript?.length) {
    throw new Error("No transcript segments provided");
  }

  const { MODEL, MAX_SEGMENTS_PER_CHUNK, CHUNK_SENTINEL } = REFINER_CONFIG;

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

  const userPreamble = `Video Title: ${title || ''}
Video Description: ${description || ''}

Transcript Chunk:`;

  const ranges = chunkSegmentsByCount(transcript, MAX_SEGMENTS_PER_CHUNK);
  const startTime = Date.now();
  console.log(`Processing ${ranges.length} chunks in parallel...`);

  // Build and execute all API requests in parallel (like Python llm.batch())
  const responses = await Promise.all(
    ranges.map(([startIdx, endIdx], chunkIdx) => {
      const chunkStartTime = Date.now();
      const chunkSegments = transcript.slice(startIdx, endIdx);
      const chunkText = chunkSegments
        .map(seg => (seg.text || '').split(/\s+/).join(' '))
        .join('\n');

      return fetch(API_ENDPOINTS.OPENROUTER, {
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
            { role: 'user', content: `${userPreamble}\n${chunkText}` },
          ],
          temperature: 0,
          reasoning: { effort: 'minimal' },
          include_reasoning: false,
          provider: { sort: 'throughput' },
        }),
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `OpenRouter API error for chunk ${chunkIdx + 1}: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        const refinedLines = data.choices[0].message.content.trim().split('\n');
        const duration = ((Date.now() - chunkStartTime) / 1000).toFixed(2);

        console.log(
          `Chunk ${chunkIdx + 1}/${ranges.length}: ${refinedLines.length}/${chunkSegments.length} lines [${duration}s]`
        );

        if (refinedLines.length !== chunkSegments.length) {
          console.warn(`⚠️ Line count mismatch in chunk ${chunkIdx + 1}!`);
        }

        if (onProgress) onProgress(chunkIdx + 1, ranges.length);

        return refinedLines;
      });
    })
  );

  console.log(`All chunks completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  // Combine responses with sentinels
  const refinedText = responses
    .flatMap(lines => [...lines, CHUNK_SENTINEL])
    .join('\n');

  // Parse back into segments with preserved timestamps
  const refinedSegments = parseRefinedSegments(
    refinedText,
    transcript,
    CHUNK_SENTINEL,
    MAX_SEGMENTS_PER_CHUNK
  );

  console.log(`Refinement complete: ${refinedSegments.length} segments`);
  return refinedSegments;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { refineTranscriptWithLLM, REFINER_CONFIG };
}
