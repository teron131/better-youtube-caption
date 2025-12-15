/**
 * Background Script Message Handlers
 * Handles messages from content and sidepanel scripts
 */

import { executeSummarizationWorkflow } from "../captionSummarizer.js";
import { ERROR_MESSAGES } from "../constants.js";
import { ensureStorageSpace, getStoredSubtitles, saveSubtitles } from "../storage.js";
import { fetchYouTubeTranscript, formatTimestamp, refineTranscriptSegments } from "../transcript.js";
import { getApiKeys } from "./apiValidation.js";
import { extractErrorMessage } from "./errorHandling.js";
import { sendError, sendStatusUpdate, sendSubtitlesGenerated, sendSummaryGenerated } from "./messageUtils.js";
import { getRefinerModelFromStorage, getSummarizerModelFromStorage, getTargetLanguageFromStorage } from "./modelSelection.js";
import { convertS2T, convertSegmentsS2T } from "./opencc.js";

// Track running summary generations to prevent concurrent runs
const runningSummaryGenerations = new Set();

/**
 * Check if summary generation is already running
 * @param {string} videoId - Video ID
 * @returns {boolean} True if already running
 */
function isSummaryGenerationRunning(videoId) {
  return runningSummaryGenerations.has(videoId);
}

/**
 * Mark summary generation as running
 * @param {string} videoId - Video ID
 */
function markSummaryGenerationRunning(videoId) {
  runningSummaryGenerations.add(videoId);
}

/**
 * Mark summary generation as complete
 * @param {string} videoId - Video ID
 */
function markSummaryGenerationComplete(videoId) {
  runningSummaryGenerations.delete(videoId);
}

/**
 * Validate video ID
 * @param {string} videoId - Video ID to validate
 * @returns {Object} Validation result
 */
function validateVideoId(videoId) {
  if (!videoId) {
    return { isValid: false, error: ERROR_MESSAGES.VIDEO_ID_REQUIRED };
  }
  return { isValid: true };
}

/**
 * Fetch and validate transcript
 * @param {string} urlForApi - YouTube URL
 * @param {string} scrapeCreatorsKey - API key
 * @returns {Promise<Object>} Transcript data or null
 */
async function fetchAndValidateTranscript(urlForApi, scrapeCreatorsKey) {
  const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);

  if (!transcriptData?.segments?.length) {
    console.log("No transcript available, skipping");
    return null;
  }

  console.log(`Fetched ${transcriptData.segments.length} transcript segments`);
  return transcriptData;
}

/**
 * Enhance segments with startTimeText
 * @param {Array} segments - Transcript segments
 * @returns {Array} Enhanced segments
 */
function enhanceSegmentsWithTimestamps(segments) {
  return segments.map((seg) => ({
    ...seg,
    startTimeText: seg.startTimeText || formatTimestamp(seg.startTime),
  }));
}

/**
 * Refine transcript segments with error handling
 * @param {Array} enhancedSegments - Enhanced segments
 * @param {string} title - Video title
 * @param {string} description - Video description
 * @param {string} openRouterKey - OpenRouter API key
 * @param {string} modelSelection - Model selection
 * @param {number|null} tabId - Tab ID
 * @returns {Promise<Array>} Refined segments or original if refinement fails
 */
async function refineSegmentsWithFallback(
  enhancedSegments,
  title,
  description,
  openRouterKey,
  modelSelection,
  tabId
) {
  if (!openRouterKey?.trim()) {
    console.log("OpenRouter API key not found, skipping refinement");
    return enhancedSegments;
  }

  sendStatusUpdate(tabId, "Refining transcript with AI...");

  try {
    const progressCallback = (message) => {
      console.log("Background (transcript): Progress -", message);
      sendStatusUpdate(tabId, message);
    };

    console.log(
      "Background (transcript): Starting refinement with",
      enhancedSegments.length,
      "segments"
    );
    const refined = await refineTranscriptSegments(
      enhancedSegments,
      title,
      description,
      openRouterKey,
      progressCallback,
      modelSelection
    );

    console.log(`Background (transcript): Refinement complete - ${refined.length} segments`);
    return refined;
  } catch (refinementError) {
    console.warn("Transcript refinement failed, using original:", refinementError);
    const errorMessage = extractErrorMessage(refinementError);
    sendError(tabId, errorMessage);
    sendStatusUpdate(tabId, "Using original transcript (refinement failed)");
    return enhancedSegments;
  }
}

/**
 * Process and save subtitles
 * @param {string} videoId - Video ID
 * @param {Array} subtitles - Subtitle segments
 * @param {number|null} tabId - Tab ID
 */
async function processAndSaveSubtitles(videoId, subtitles, tabId) {
  // Convert Simplified Chinese to Traditional Chinese
  const convertedSubtitles = convertSegmentsS2T(subtitles);

  // Send to content script
  sendSubtitlesGenerated(tabId, convertedSubtitles, videoId);
  sendStatusUpdate(tabId, "Transcript fetched and ready!", true);

  // Save subtitles
  try {
    await ensureStorageSpace();
  } catch (storageError) {
    console.warn("Storage management failed:", storageError);
  }

  await saveSubtitles(videoId, convertedSubtitles);
  console.log("Background: Subtitle fetch completed successfully");
}

/**
 * Generate summary workflow
 * @param {string} transcriptText - Transcript text
 * @param {string} modelSelection - Model selection
 * @param {string} targetLanguage - Target language
 * @param {string} openRouterKey - OpenRouter API key
 * @param {number|null} tabId - Tab ID
 * @returns {Promise<Object>} Workflow result
 */
async function executeSummaryWorkflow(
  transcriptText,
  modelSelection,
  targetLanguage,
  openRouterKey,
  tabId
) {
  const progressCallback = (message) => {
    console.log("Summary workflow:", message);
    sendStatusUpdate(tabId, message);
  };

  return await executeSummarizationWorkflow(
    {
      transcript: transcriptText,
      analysis_model: modelSelection,
      quality_model: modelSelection,
      target_language: targetLanguage,
    },
    openRouterKey,
    progressCallback
  );
}

/**
 * Handle generate summary request
 * @param {Object} message - Message object
 * @param {number|null} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
export async function handleGenerateSummary(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
    targetLanguage: messageTargetLanguage,
  } = message;

  console.log("Background Script: Received generateSummary request for Video ID:", videoId);

  const validation = validateVideoId(videoId);
  if (!validation.isValid) {
    sendResponse({ status: "error", message: validation.error });
    return;
  }

  if (isSummaryGenerationRunning(videoId)) {
    sendResponse({ status: "error", message: ERROR_MESSAGES.SUMMARY_IN_PROGRESS });
    return;
  }

  markSummaryGenerationRunning(videoId);
  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    sendStatusUpdate(tabId, "Fetching YouTube transcript...");

    // Get API keys
    const { scrapeCreatorsKey, openRouterKey } = await getApiKeys(
      messageScrapeCreatorsKey,
      messageOpenRouterKey
    );

    if (!scrapeCreatorsKey) {
      throw new Error(ERROR_MESSAGES.SCRAPE_KEY_MISSING);
    }
    if (!openRouterKey) {
      throw new Error(ERROR_MESSAGES.OPENROUTER_KEY_MISSING);
    }

    // Get model and language selection
    const modelSelection =
      messageModelSelection || (await getSummarizerModelFromStorage());
    const targetLanguage =
      messageTargetLanguage || (await getTargetLanguageFromStorage());

    console.log("Background (summary): using model", modelSelection);

    // Fetch transcript
    const transcriptData = await fetchAndValidateTranscript(urlForApi, scrapeCreatorsKey);
    if (!transcriptData) {
      sendStatusUpdate(tabId, ERROR_MESSAGES.NO_TRANSCRIPT, false, true);
      return;
    }

    console.log(`Fetched ${transcriptData.segments.length} transcript segments for summary`);

    sendStatusUpdate(tabId, "Generating summary with AI...");

    // Generate summary
    const transcriptText = transcriptData.segments.map((seg) => seg.text).join(" ");
    const workflowResult = await executeSummaryWorkflow(
      transcriptText,
      modelSelection,
      targetLanguage,
      openRouterKey,
      tabId
    );

    let summary = workflowResult.summary_text;

    console.log(
      `Summary workflow completed: ${workflowResult.iteration_count} iterations, ` +
        `quality score: ${workflowResult.quality_score}%`
    );

    // Convert Simplified Chinese to Traditional Chinese
    summary = convertS2T(summary);

    // Save summary to storage
    chrome.storage.local.set({ [`summary_${videoId}`]: summary });

    // Send summary to content script/sidepanel
    sendSummaryGenerated(tabId, summary, videoId);

    sendStatusUpdate(tabId, "Summary generated successfully!", true);
    sendResponse({ status: "completed" });
  } catch (error) {
    console.error("Error generating summary:", error);
    const errorMessage = extractErrorMessage(error);

    if (tabId) {
      sendError(tabId, errorMessage);
      sendStatusUpdate(tabId, `Error: ${errorMessage}`, false, true);
    }
    sendResponse({ status: "error", message: errorMessage });
  } finally {
    markSummaryGenerationComplete(videoId);
  }
}

/**
 * Handle fetch subtitles request
 * @param {Object} message - Message object
 * @param {number|null} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
export async function handleFetchSubtitles(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
    forceRegenerate = false,
  } = message;

  console.log("Background Script: Received fetchSubtitles request for Video ID:", videoId);

  const validation = validateVideoId(videoId);
  if (!validation.isValid) {
    sendResponse({ status: "error", message: validation.error });
    return;
  }

  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;
  console.log("Background Script: Using URL for API:", urlForApi);

  // Send immediate acknowledgment
  sendResponse({ status: "processing", message: "Request received, processing..." });

  if (!forceRegenerate) {
    // Check if subtitles are cached
    try {
      const cachedSubtitles = await getStoredSubtitles(videoId);
      if (cachedSubtitles) {
        console.log("Subtitles found in local storage for this video.");
        sendSubtitlesGenerated(tabId, cachedSubtitles, videoId);
        return;
      }
    } catch (error) {
      console.error("Error checking storage:", error);
    }
  } else {
    console.log("Force regenerate subtitles requested, bypassing cache.");
  }

  processNewSubtitles(
    urlForApi,
    videoId,
    messageScrapeCreatorsKey,
    messageOpenRouterKey,
    messageModelSelection,
    tabId
  );
}

/**
 * Process new subtitles (fetch and refine)
 * @param {string} urlForApi - YouTube URL
 * @param {string} videoId - Video ID
 * @param {string} messageScrapeCreatorsKey - Scrape Creators API key from message
 * @param {string} messageOpenRouterKey - OpenRouter API key from message
 * @param {string} messageModelSelection - Model selection from message
 * @param {number|null} tabId - Tab ID
 */
async function processNewSubtitles(
  urlForApi,
  videoId,
  messageScrapeCreatorsKey,
  messageOpenRouterKey,
  messageModelSelection,
  tabId
) {
  console.log("No cached subtitles found. Fetching transcript...");
  sendStatusUpdate(tabId, "Fetching YouTube transcript...");

  try {
    // Get API keys
    const { scrapeCreatorsKey, openRouterKey } = await getApiKeys(
      messageScrapeCreatorsKey,
      messageOpenRouterKey
    );

    if (!scrapeCreatorsKey) {
      throw new Error(ERROR_MESSAGES.SCRAPE_KEY_MISSING);
    }

    // Fetch transcript
    const transcriptData = await fetchAndValidateTranscript(urlForApi, scrapeCreatorsKey);
    if (!transcriptData) {
      sendStatusUpdate(tabId, ERROR_MESSAGES.NO_TRANSCRIPT, false, true);
      return;
    }

    console.log(`Video title: ${transcriptData.title}`);

    // Enhance segments with timestamps
    const enhancedSegments = enhanceSegmentsWithTimestamps(transcriptData.segments);

    // Get model selection
    const modelSelection =
      messageModelSelection || (await getRefinerModelFromStorage());
    console.log("Background (transcript): using model", modelSelection);

    // Refine transcript if OpenRouter key is available
    const subtitles = await refineSegmentsWithFallback(
      enhancedSegments,
      transcriptData.title,
      transcriptData.description,
      openRouterKey,
      modelSelection,
      tabId
    );

    // Process and save subtitles
    await processAndSaveSubtitles(videoId, subtitles, tabId);
  } catch (error) {
    console.error("Error fetching/parsing subtitles:", error);
    const errorMessage = `Error: ${extractErrorMessage(error)}`;
    sendStatusUpdate(tabId, errorMessage, false, true);
  }
}
