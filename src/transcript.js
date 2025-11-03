// YouTube transcript fetching and refinement
// Combines transcript fetching (Scrape Creators API) and refinement (OpenRouter/Gemini)

/**
 * Fetches YouTube transcript and metadata using Scrape Creators API
 * @param {string} videoUrl - YouTube video URL
 * @param {string} apiKey - Scrape Creators API key
 * @returns {Promise<Object>} Object with segments array and metadata: {segments: Array, title: string, description: string, transcriptText: string}
 */
async function fetchYouTubeTranscript(videoUrl, apiKey) {
  if (!apiKey) {
    throw new Error("Scrape Creators API key is required");
  }

  // Clean the YouTube URL
  const cleanedUrl = cleanYouTubeUrl(videoUrl);
  
  // Call Scrape Creators API
  const apiUrl = `${API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(cleanedUrl)}&get_transcript=true`;
  
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorMessage;
    } catch (e) {
      // If response is not JSON, use status text
      errorMessage = await response.text() || errorMessage;
    }
    throw new Error(`Scrape Creators API error: ${errorMessage}`);
  }

  const data = await response.json();

  // Extract transcript segments
  if (!data.transcript || !Array.isArray(data.transcript) || data.transcript.length === 0) {
    throw new Error("No transcript available for this video");
  }

  // Convert transcript segments to our format
  // API returns: {text, startMs, endMs, startTimeText}
  // We need: {startTime, endTime, text, startTimeText} where times are in milliseconds (numbers)
  const segments = data.transcript.map((segment) => {
    const startTime = parseInt(segment.startMs, 10);
    const endTime = parseInt(segment.endMs, 10);

    if (isNaN(startTime) || isNaN(endTime)) {
      console.warn("Invalid timestamp in transcript segment:", segment);
      return null;
    }

    return {
      startTime: startTime,
      endTime: endTime,
      text: segment.text.trim(),
      startTimeText: segment.startTimeText || null, // Preserve startTimeText for formatting
    };
  }).filter((segment) => segment !== null);

  if (segments.length === 0) {
    throw new Error("No valid transcript segments found");
  }

  console.log(`Fetched ${segments.length} transcript segments from Scrape Creators API`);
  
  // Return segments with metadata for refinement
  return {
    segments: segments,
    title: data.title || "",
    description: data.description || "",
    transcriptText: data.transcript_only_text || "",
  };
}

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

// Import the robust refiner module
// (Note: The refiner module is loaded separately via manifest.json)

/**
 * Refines transcript segments using AI with robust alignment algorithm.
 * Uses the new refiner module with dynamic programming alignment.
 * 
 * @param {Array<Object>} segments - Original transcript segments
 * @param {string} title - Video title for context
 * @param {string} description - Video description for context
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional callback for progress updates (message string)
 * @param {string} model - Model to use (e.g., "google/gemini-2.5-flash-lite")
 * @returns {Promise<Array<Object>>} Refined transcript segments with preserved timestamps
 */
async function refineTranscriptSegments(segments, title, description, openRouterApiKey, progressCallback, model = DEFAULTS.MODEL) {
  if (!segments || segments.length === 0) {
    throw new Error("No transcript segments provided");
  }

  // Convert segments to format expected by refiner
  // Refiner expects: {text, startMs, endMs, startTimeText}
  const refinerSegments = segments.map(seg => ({
    text: seg.text,
    startMs: seg.startTime, // Already in milliseconds
    endMs: seg.endTime,
    startTimeText: seg.startTimeText || formatTimestamp(seg.startTime),
  }));

  // Progress callback adapter: converts (chunkIdx, totalChunks) to message string
  const progressAdapter = progressCallback ? (chunkIdx, totalChunks) => {
    progressCallback(`Refining chunk ${chunkIdx}/${totalChunks}...`);
  } : null;

  // Use the robust refiner
  const refinedSegments = await refineTranscriptWithLLM(
    refinerSegments,
    title,
    description,
    openRouterApiKey,
    progressAdapter
  );

  // Convert back to our format: {startTime, endTime, text, startTimeText}
  const result = refinedSegments.map(seg => ({
    startTime: seg.startMs,
    endTime: seg.endMs,
    text: seg.text,
    startTimeText: seg.startTimeText,
  }));

  console.log(`Refined ${result.length} transcript segments`);
  
  return result;
}

