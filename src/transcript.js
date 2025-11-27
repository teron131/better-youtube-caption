/**
 * YouTube Transcript Fetching and Refinement
 */

import { refineTranscriptWithLLM } from "./captionRefiner.js";
import { API_ENDPOINTS, DEFAULTS } from "./constants.js";
import { cleanYouTubeUrl } from "./url.js";

/**
 * Fetch YouTube transcript and metadata using Scrape Creators API
 */
export async function fetchYouTubeTranscript(videoUrl, apiKey) {
  if (!apiKey) throw new Error("Scrape Creators API key is required");

  const apiUrl = `${API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(
    cleanYouTubeUrl(videoUrl)
  )}&get_transcript=true`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    // Don't throw error, just return null if API fails
    console.warn(`Scrape Creators API request failed with status ${response.status}`);
    return null;
  }

  const data = await response.json();

  if (!data.transcript?.length) {
    // No transcript available, return null instead of throwing
    console.warn("No transcript available for this video");
    return null;
  }

  // Convert to internal format
  const segments = data.transcript
    .map((seg) => {
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

  if (!segments.length) {
    // No valid segments found, return null instead of throwing
    console.warn("No valid transcript segments found");
    return null;
  }

  console.log(`Fetched ${segments.length} transcript segments from Scrape Creators API`);

  return {
    segments,
    title: data.title || "",
    description: data.description || "",
    transcriptText: data.transcript_only_text || "",
  };
}

/**
 * Format transcript segments as text with timestamps
 */
export function formatTranscriptSegments(segments) {
  return segments
    .map((seg) => {
      const text = seg.text.split(/\s+/).join(" ");
      const timestamp = seg.startTimeText || formatTimestamp(seg.startTime);
      return `[${timestamp}] ${text}`;
    })
    .join("\n");
}

/**
 * Format timestamp in milliseconds to M:SS
 */
export function formatTimestamp(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Refine transcript segments using AI
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

  // Convert to refiner format: {text, startMs, endMs, startTimeText}
  const refinerSegments = segments.map((seg) => ({
    text: seg.text,
    startMs: seg.startTime,
    endMs: seg.endTime,
    startTimeText: seg.startTimeText || formatTimestamp(seg.startTime),
  }));

  // Progress callback adapter
  const progressAdapter = progressCallback
    ? (chunkIdx, totalChunks) => progressCallback(`Refining chunk ${chunkIdx}/${totalChunks}...`)
    : null;

  // Use refiner
  const refinedSegments = await refineTranscriptWithLLM(
    refinerSegments,
    title,
    description,
    openRouterApiKey,
    progressAdapter,
    model
  );

  // Convert back to internal format
  const result = refinedSegments.map((seg) => ({
    startTime: seg.startMs,
    endTime: seg.endMs,
    text: seg.text,
    startTimeText: seg.startTimeText,
  }));

  console.log(`Refined ${result.length} transcript segments`);
  return result;
}
