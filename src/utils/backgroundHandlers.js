/**
 * Background Script Message Handlers
 * Handles messages from content and sidepanel scripts
 */

import { executeSummarizationWorkflow } from "../captionSummarizer.js";
import { ERROR_MESSAGES } from "../constants.js";
import { ensureStorageSpace, getStoredSubtitles, saveSubtitles } from "../storage.js";
import {
  enhanceSegmentsWithTimestamps,
  fetchYouTubeTranscript,
  refineTranscriptSegments
} from "../transcript.js";
import { getApiKeys } from "./apiValidation.js";
import { extractErrorMessage } from "./errorHandling.js";
import { sendError, sendStatusUpdate, sendSubtitlesGenerated, sendSummaryGenerated } from "./messageUtils.js";
import { getRefinerModelFromStorage, getSummarizerModelFromStorage, getTargetLanguageFromStorage } from "./modelSelection.js";
import { convertS2T, convertSegmentsS2T } from "./opencc.js";
import { validateVideoId } from "./videoUtils.js";

// Track running summary generations to prevent concurrent runs
const runningSummaryGenerations = new Set();

/**
 * Summary generation lock management
 */
const summaryLock = {
  isRunning: (videoId) => runningSummaryGenerations.has(videoId),
  acquire: (videoId) => runningSummaryGenerations.add(videoId),
  release: (videoId) => runningSummaryGenerations.delete(videoId),
};

/**
 * Create progress callback for refinement
 */
function createRefinementProgressCallback(tabId) {
  return (message) => {
    console.log("Refinement progress:", message);
    sendStatusUpdate(tabId, message);
  };
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
    console.log("OpenRouter key not found, skipping refinement");
    return enhancedSegments;
  }

  sendStatusUpdate(tabId, "Refining transcript with AI...");

  try {
    console.log(`Starting refinement with ${enhancedSegments.length} segments`);
    const refined = await refineTranscriptSegments(
      enhancedSegments,
      title,
      description,
      openRouterKey,
      createRefinementProgressCallback(tabId),
      modelSelection
    );

    console.log(`Refinement complete: ${refined.length} segments`);
    return refined;
  } catch (error) {
    console.warn("Refinement failed, using original:", error);
    sendError(tabId, extractErrorMessage(error));
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
  const convertedSubtitles = convertSegmentsS2T(subtitles);

  sendSubtitlesGenerated(tabId, convertedSubtitles, videoId);
  sendStatusUpdate(tabId, "Transcript fetched and ready!", true);

  try {
    await ensureStorageSpace();
    await saveSubtitles(videoId, convertedSubtitles);
    console.log("Subtitles saved successfully");
  } catch (error) {
    console.warn("Storage error:", error);
  }
}

/**
 * Create progress callback for summary workflow
 */
function createSummaryProgressCallback(tabId) {
  return (message) => {
    console.log("Summary progress:", message);
    sendStatusUpdate(tabId, message);
  };
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
  return executeSummarizationWorkflow(
    {
      transcript: transcriptText,
      analysis_model: modelSelection,
      quality_model: modelSelection,
      target_language: targetLanguage,
    },
    openRouterKey,
    createSummaryProgressCallback(tabId)
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

  console.log("Received generateSummary request for video:", videoId);

  const validation = validateVideoId(videoId);
  if (!validation.isValid) {
    sendResponse({ status: "error", message: validation.error });
    return;
  }

  if (summaryLock.isRunning(videoId)) {
    sendResponse({ status: "error", message: ERROR_MESSAGES.SUMMARY_IN_PROGRESS });
    return;
  }

  summaryLock.acquire(videoId);
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
    const modelSelection = messageModelSelection || (await getSummarizerModelFromStorage());
    const targetLanguage = messageTargetLanguage || (await getTargetLanguageFromStorage());

    console.log("Using summarizer model:", modelSelection);

    // Fetch transcript
    const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
    if (!transcriptData?.segments?.length) {
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
    summaryLock.release(videoId);
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

  console.log("Received fetchSubtitles request for video:", videoId);

  const validation = validateVideoId(videoId);
  if (!validation.isValid) {
    sendResponse({ status: "error", message: validation.error });
    return;
  }

  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;
  sendResponse({ status: "processing", message: "Request received, processing..." });

  if (!forceRegenerate) {
    try {
      const cachedSubtitles = await getStoredSubtitles(videoId);
      if (cachedSubtitles) {
        console.log("Using cached subtitles");
        sendSubtitlesGenerated(tabId, cachedSubtitles, videoId);
        return;
      }
    } catch (error) {
      console.error("Storage check error:", error);
    }
  } else {
    console.log("Force regenerate requested, bypassing cache");
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
  sendStatusUpdate(tabId, "Fetching YouTube transcript...");

  try {
    const { scrapeCreatorsKey, openRouterKey } = await getApiKeys(
      messageScrapeCreatorsKey,
      messageOpenRouterKey
    );

    if (!scrapeCreatorsKey) {
      throw new Error(ERROR_MESSAGES.SCRAPE_KEY_MISSING);
    }

    const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
    if (!transcriptData?.segments?.length) {
      sendStatusUpdate(tabId, ERROR_MESSAGES.NO_TRANSCRIPT, false, true);
      return;
    }

    console.log(`Fetched ${transcriptData.segments.length} segments`);

    console.log(`Video: ${transcriptData.title}`);

    const enhancedSegments = enhanceSegmentsWithTimestamps(transcriptData.segments);
    const modelSelection = messageModelSelection || (await getRefinerModelFromStorage());
    
    console.log("Using refiner model:", modelSelection);

    const subtitles = await refineSegmentsWithFallback(
      enhancedSegments,
      transcriptData.title,
      transcriptData.description,
      openRouterKey,
      modelSelection,
      tabId
    );

    await processAndSaveSubtitles(videoId, subtitles, tabId);
  } catch (error) {
    console.error("Subtitle processing error:", error);
    sendStatusUpdate(tabId, `Error: ${extractErrorMessage(error)}`, false, true);
  }
}
