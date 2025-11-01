// Transcript refinement utility using Gemini via OpenRouter
// Based on the approach from test.ipynb

/**
 * Formats transcript segments as simple newline-separated text.
 * Format: [timestamp] text (one segment per line)
 * Removes internal newlines from each segment and joins with spaces.
 * 
 * @param {Array<Object>} segments - Array of transcript segments with {startTime, endTime, text, startTimeText}
 * @returns {string} Formatted transcript text with one segment per line
 */
function formatTranscriptSegments(segments) {
  const formattedSegments = [];
  
  for (const seg of segments) {
    // Remove internal newlines and normalize whitespace
    const normalizedText = seg.text.split(/\s+/).join(" ");
    
    // Use startTimeText if available, otherwise format from startTime
    const timestamp = seg.startTimeText || formatTimestamp(seg.startTime);
    
    formattedSegments.push(`[${timestamp}] ${normalizedText}`);
  }
  
  return formattedSegments.join("\n");
}

/**
 * Formats a timestamp in milliseconds to [M:SS] format.
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted timestamp like "0:03"
 */
function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Refines transcript using Gemini via OpenRouter API.
 * Fixes typos and grammar errors while preserving structure and timestamps.
 * 
 * @param {string} formattedTranscript - Formatted transcript text (one segment per line)
 * @param {string} title - Video title for context
 * @param {string} description - Video description for context
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional callback for progress updates
 * @param {string} model - Model to use (e.g., "google/gemini-2.5-flash-lite")
 * @returns {Promise<string>} Refined transcript text with same format
 */
async function refineTranscript(formattedTranscript, title, description, openRouterApiKey, progressCallback, model = "google/gemini-2.5-flash-lite") {
  if (!openRouterApiKey) {
    throw new Error("OpenRouter API key is required");
  }

  if (progressCallback) {
    progressCallback("Sending transcript to AI for refinement...");
  }

  // System prompt with title and description context
  const systemPrompt = `You are correcting a YouTube video transcript. Use the full contextual understanding to ground your corrections, especially for special terms.

Video Title: ${title || "Unknown"}
Video Description: ${description || "No description available"}

CRITICAL CONSTRAINTS:
1. Only fix typos and grammar errors. Do NOT change the meaning or structure.
2. PRESERVE ALL NEWLINES - each line represents a separate transcript segment.
3. PRESERVE TIMESTAMPS - keep the [timestamp] format exactly as shown.
4. Do NOT merge lines together - keep the same number of lines.
5. Keep text length similar to original - don't make sentences too long or short.
6. If a sentence is broken across lines, keep it broken - only fix typos/grammar within each line.`;

  // User message with transcript
  const userPrompt = `Refine the following transcript by fixing typos and grammar errors. Preserve all newlines and timestamps exactly as shown.

Transcript:
${formattedTranscript}

Return the refined transcript with the same number of lines and timestamps preserved.`;

  // Call OpenRouter API
  const apiUrl = "https://openrouter.ai/api/v1/chat/completions";
  
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openRouterApiKey}`,
      "HTTP-Referer": chrome.runtime.getURL(""), // Optional: for OpenRouter analytics
      "X-Title": "YouTube Subtitles Generator", // Optional: for OpenRouter analytics
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      provider: {
        sort: "throughput",
      },
    }),
  });

  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorMessage;
    } catch (e) {
      const errorText = await response.text();
      errorMessage = errorText || errorMessage;
    }
    throw new Error(`OpenRouter API error: ${errorMessage}`);
  }

  const data = await response.json();
  
  // Extract refined text from response
  let refinedText = "";
  if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
    refinedText = data.choices[0].message.content.trim();
  } else {
    throw new Error("Invalid response format from OpenRouter API");
  }

  if (progressCallback) {
    progressCallback("Transcript refined successfully");
  }

  return refinedText;
}

/**
 * Parses refined transcript back into segments, preserving original timestamps.
 * The refined text should have format: [timestamp] text (one segment per line).
 * 
 * @param {string} refinedText - Refined transcript text (one segment per line)
 * @param {Array<Object>} originalSegments - Original transcript segments with timestamps
 * @returns {Array<Object>} Refined segments with preserved timestamps
 */
function parseRefinedTranscript(refinedText, originalSegments) {
  const lines = refinedText.trim().split("\n");
  const refinedSegments = [];

  for (let i = 0; i < lines.length && i < originalSegments.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Extract timestamp and text from line
    // Format: [timestamp] text
    const timestampMatch = line.match(/^\[([^\]]+)\]\s*(.*)$/);

    if (timestampMatch) {
      const origSeg = originalSegments[i];
      const refinedTextOnly = timestampMatch[2].trim();

      refinedSegments.push({
        startTime: origSeg.startTime, // Preserve original timestamps
        endTime: origSeg.endTime,
        text: refinedTextOnly,
        startTimeText: origSeg.startTimeText || formatTimestamp(origSeg.startTime),
      });
    } else {
      // Fallback: use original segment if parsing fails
      const origSeg = originalSegments[i];
      refinedSegments.push({
        startTime: origSeg.startTime,
        endTime: origSeg.endTime,
        text: line.trim(),
        startTimeText: origSeg.startTimeText || formatTimestamp(origSeg.startTime),
      });
    }
  }

  // If we got fewer lines than segments, pad with originals
  while (refinedSegments.length < originalSegments.length) {
    const origSeg = originalSegments[refinedSegments.length];
    refinedSegments.push({
      startTime: origSeg.startTime,
      endTime: origSeg.endTime,
      text: origSeg.text,
      startTimeText: origSeg.startTimeText || formatTimestamp(origSeg.startTime),
    });
  }

  return refinedSegments;
}

/**
 * Refines transcript segments using AI.
 * This is the main function that orchestrates the refinement process.
 * 
 * @param {Array<Object>} segments - Original transcript segments
 * @param {string} title - Video title for context
 * @param {string} description - Video description for context
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional callback for progress updates
 * @param {string} model - Model to use (e.g., "google/gemini-2.5-flash-lite")
 * @returns {Promise<Array<Object>>} Refined transcript segments with preserved timestamps
 */
async function refineTranscriptSegments(segments, title, description, openRouterApiKey, progressCallback, model = "google/gemini-2.5-flash-lite") {
  if (!segments || segments.length === 0) {
    throw new Error("No transcript segments provided");
  }

  // Format segments for LLM input
  const formattedTranscript = formatTranscriptSegments(segments);

  // Refine using AI
  const refinedText = await refineTranscript(
    formattedTranscript,
    title,
    description,
    openRouterApiKey,
    progressCallback,
    model
  );

  // Parse refined text back into segments
  const refinedSegments = parseRefinedTranscript(refinedText, segments);

  console.log(`Refined ${refinedSegments.length} transcript segments`);
  
  return refinedSegments;
}

