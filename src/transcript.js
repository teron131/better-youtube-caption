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
 * Enhance segments with startTimeText if missing
 * @param {Array} segments - Transcript segments
 * @returns {Array} Enhanced segments
 */
export function enhanceSegmentsWithTimestamps(segments) {
  return segments.map((seg) => ({
    ...seg,
    startTimeText: seg.startTimeText || formatTimestamp(seg.startTime),
  }));
}


/**
 * Adapt internal segment format to refiner format
 */
function toRefinerFormat(segment) {
  return {
    text: segment.text,
    startMs: segment.startTime,
    endMs: segment.endTime,
    startTimeText: segment.startTimeText || formatTimestamp(segment.startTime),
  };
}

/**
 * Adapt refiner format back to internal segment format
 */
function fromRefinerFormat(segment) {
  return {
    startTime: segment.startMs,
    endTime: segment.endMs,
    text: segment.text,
    startTimeText: segment.startTimeText,
  };
}

/**
 * Refine transcript segments using LLM
 * @param {Array} segments - Transcript segments
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {Function} progressCallback - Progress callback (optional)
 * @param {string} model - Model name (defaults to DEFAULTS.MODEL_REFINER)
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

  // Convert segments to refiner format and refine
  const refinerSegments = segments.map(toRefinerFormat);
  const progressAdapter = progressCallback
    ? (chunkIdx, totalChunks) => progressCallback(`Refining chunk ${chunkIdx}/${totalChunks}...`)
    : null;

  const refinedSegments = await refineTranscriptWithLLM(
    refinerSegments,
    title,
    description,
    openRouterApiKey,
    progressAdapter,
    model
  );

  // Convert back to internal format
  const result = refinedSegments.map(fromRefinerFormat);
  console.log(`Refined ${result.length} segments`);
  return result;
}
