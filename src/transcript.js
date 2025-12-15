/**
 * YouTube transcript fetching and refinement
 */

import { refineTranscriptWithLLM } from "./captionRefiner.js";
import { API_ENDPOINTS, DEFAULTS } from "./constants.js";
import { cleanYouTubeUrl } from "./url.js";

/**
 * Fetch YouTube transcript from Scrape Creators API
 * @param {string} videoUrl - YouTube video URL
 * @param {string} apiKey - Scrape Creators API key
 * @returns {Promise<Object|null>} Transcript data or null
 */
export async function fetchYouTubeTranscript(videoUrl, apiKey) {
  if (!apiKey) {
    throw new Error("Scrape Creators API key is required");
  }

  const apiUrl = `${API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(
    cleanYouTubeUrl(videoUrl)
  )}&get_transcript=true`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    console.warn(`Scrape Creators API failed: ${response.status}`);
    return null;
  }

  const data = await response.json();

  if (!data.transcript?.length) {
    console.warn("No transcript available for this video");
    return null;
  }

  const segments = convertTranscriptSegments(data.transcript);

  if (!segments.length) {
    console.warn("No valid transcript segments found");
    return null;
  }

  console.log(`Fetched ${segments.length} transcript segments`);

  return {
    segments,
    title: data.title || "",
    description: data.description || "",
    transcriptText: data.transcript_only_text || "",
  };
}

/**
 * Convert API transcript segments to internal format
 */
function convertTranscriptSegments(apiSegments) {
  return apiSegments
    .map(seg => {
      const startTime = parseInt(seg.startMs, 10);
      const endTime = parseInt(seg.endMs, 10);

      if (isNaN(startTime) || isNaN(endTime)) {
        console.warn("Invalid timestamp in segment:", seg);
        return null;
      }

      return {
        startTime,
        endTime,
        text: seg.text.trim(),
        startTimeText: seg.startTimeText || null,
      };
    })
    .filter(Boolean);
}

/**
 * Format timestamp in milliseconds to M:SS
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted timestamp
 */
export function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Convert internal format to refiner format
 */
function convertToRefinerFormat(segments) {
  return segments.map(seg => ({
    text: seg.text,
    startMs: seg.startTime,
    endMs: seg.endTime,
    startTimeText: seg.startTimeText || formatTimestamp(seg.startTime),
  }));
}

/**
 * Convert refiner format back to internal format
 */
function convertFromRefinerFormat(segments) {
  return segments.map(seg => ({
    startTime: seg.startMs,
    endTime: seg.endMs,
    text: seg.text,
    startTimeText: seg.startTimeText,
  }));
}

/**
 * Create progress callback adapter
 */
function createProgressAdapter(progressCallback) {
  if (!progressCallback) return null;
  return (chunkIdx, totalChunks) => 
    progressCallback(`Refining chunk ${chunkIdx}/${totalChunks}...`);
}

/**
 * Refine transcript segments using LLM
 * @param {Array} segments - Transcript segments
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {Function} progressCallback - Progress callback
 * @param {string} model - Model name
 * @returns {Promise<Array>} Refined segments
 */
export async function refineTranscriptSegments(
  segments,
  title,
  description,
  openRouterApiKey,
  progressCallback,
  model = DEFAULTS.MODEL_REFINER
) {
  if (!segments?.length) {
    throw new Error("No transcript segments provided");
  }

  const refinerSegments = convertToRefinerFormat(segments);
  const progressAdapter = createProgressAdapter(progressCallback);

  const refinedSegments = await refineTranscriptWithLLM(
    refinerSegments,
    title,
    description,
    openRouterApiKey,
    progressAdapter,
    model
  );

  const result = convertFromRefinerFormat(refinedSegments);

  console.log(`Refined ${result.length} segments`);
  return result;
}
