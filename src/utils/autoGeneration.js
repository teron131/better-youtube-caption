/**
 * Auto-Generation Utilities
 * Handles automatic subtitle generation logic
 */

import { STORAGE_KEYS, TIMING } from "../constants.js";
import { extractVideoId } from "../url.js";
import { isExtensionContextValid } from "./contextValidation.js";
import { log as debugLog } from "./logger.js";

// Track which videos have had auto-generation triggered
const autoGenerationTriggered = new Set();

/**
 * Check if auto-generation has been triggered for a video
 * @param {string} videoId - Video ID
 * @returns {boolean} True if already triggered
 */
export function isAutoGenerationTriggered(videoId) {
  return autoGenerationTriggered.has(videoId);
}

/**
 * Mark auto-generation as triggered for a video
 * @param {string} videoId - Video ID
 */
export function markAutoGenerationTriggered(videoId) {
  autoGenerationTriggered.add(videoId);
}

/**
 * Clear auto-generation trigger for a video
 * @param {string} videoId - Video ID
 */
export function clearAutoGenerationTrigger(videoId) {
  autoGenerationTriggered.delete(videoId);
}

/**
 * Check if auto-generation conditions are met
 * @param {string} videoId - Video ID
 * @param {Object} storageResult - Storage result with settings
 * @param {boolean} showSubtitlesEnabled - Whether subtitles are enabled
 * @param {boolean} checkCaptionsEnabled - Whether to check captions setting
 * @returns {Object} Validation result
 */
export function validateAutoGenerationConditions(
  videoId,
  storageResult,
  showSubtitlesEnabled,
  checkCaptionsEnabled
) {
  if (storageResult[STORAGE_KEYS.AUTO_GENERATE] !== true) {
    debugLog("Auto-gen skipped: setting disabled");
    return { isValid: false, reason: "setting disabled" };
  }

  if (checkCaptionsEnabled && !showSubtitlesEnabled) {
    debugLog("Auto-gen skipped: captions disabled");
    return { isValid: false, reason: "captions disabled" };
  }

  if (!storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]) {
    debugLog("Auto-gen skipped: missing Scrape Creators key");
    return { isValid: false, reason: "missing api key" };
  }

  if (isAutoGenerationTriggered(videoId)) {
    debugLog("Auto-gen skipped: already triggered for video", videoId);
    return { isValid: false, reason: "already triggered" };
  }

  return { isValid: true };
}

/**
 * Verify video ID hasn't changed
 * @param {string} originalVideoId - Original video ID
 * @returns {boolean} True if video ID is still valid
 */
function verifyVideoIdUnchanged(originalVideoId) {
  const currentVideoId = extractVideoId(window.location.href);
  if (currentVideoId !== originalVideoId) {
    debugLog("Auto-gen cancel: video ID changed", originalVideoId, "->", currentVideoId);
    clearAutoGenerationTrigger(originalVideoId);
    return false;
  }
  return true;
}

/**
 * Verify captions are still enabled
 * @param {string} videoId - Video ID
 * @returns {Promise<boolean>} True if captions still enabled
 */
function verifyCaptionsStillEnabled(videoId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.SHOW_SUBTITLES], (checkResult) => {
      const captionsStillEnabled = checkResult[STORAGE_KEYS.SHOW_SUBTITLES] !== false;
      if (!captionsStillEnabled) {
        debugLog("Auto-gen cancel: captions disabled");
        clearAutoGenerationTrigger(videoId);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Execute auto-generation trigger with validation
 * @param {string} videoId - Video ID
 * @param {Object} storageResult - Storage result
 * @param {Function} triggerFn - Function to execute trigger
 * @param {boolean} checkCaptionsEnabled - Whether to check captions
 */
async function executeAutoGenerationTrigger(
  videoId,
  storageResult,
  triggerFn,
  checkCaptionsEnabled
) {
  if (!verifyVideoIdUnchanged(videoId)) {
    return;
  }

  if (checkCaptionsEnabled) {
    const captionsEnabled = await verifyCaptionsStillEnabled(videoId);
    if (!captionsEnabled) {
      return;
    }
  }

  triggerFn();
}

/**
 * Schedule auto-generation with optional delay
 * @param {string} videoId - Video ID
 * @param {Object} storageResult - Storage result
 * @param {Function} triggerFn - Function to execute trigger
 * @param {boolean} checkCaptionsEnabled - Whether to check captions
 * @param {boolean} withDelay - Whether to add delay
 */
export function scheduleAutoGeneration(
  videoId,
  storageResult,
  triggerFn,
  checkCaptionsEnabled,
  withDelay
) {
  markAutoGenerationTriggered(videoId);

  debugLog(
    "Auto-gen enabled,",
    withDelay ? "waiting for page to load..." : "triggering immediately...",
    "videoId:",
    videoId
  );

  const executeTrigger = () => {
    executeAutoGenerationTrigger(videoId, storageResult, triggerFn, checkCaptionsEnabled);
  };

  if (withDelay) {
    setTimeout(() => {
      if (!isExtensionContextValid()) {
        debugLog("Context invalidated before auto-generation, aborting.");
        clearAutoGenerationTrigger(videoId);
        return;
      }
      debugLog("Auto-gen delay elapsed; triggering now for", videoId);
      executeTrigger();
    }, TIMING.AUTO_GENERATION_DELAY_MS);
  } else {
    executeTrigger();
  }
}

