/**
 * Content Script for Better YouTube Caption Extension
 * Handles subtitle display, auto-generation, and communication with background script
 */

import {
  DEFAULTS,
  ELEMENT_IDS,
  FONT_SIZES,
  MESSAGE_ACTIONS,
  STORAGE_KEYS,
  TIMING,
  YOUTUBE,
} from "./constants.js";
import { extractVideoId } from "./url.js";
import { log as debugLog, error as logError, warn as logWarn } from "./utils/logger.js";

// Global state
let currentSubtitles = [];
let subtitleContainer = null;
let subtitleText = null;
let videoPlayer = null;
let videoContainer = null;
let checkInterval = null;
let initAttempts = 0;
let currentUrl = window.location.href;
let autoGenerationTriggered = new Set(); // Track which videos have had auto-generation triggered
let showSubtitlesEnabled = true; // Whether subtitles should be displayed
let urlMonitorInterval = null; // Polling-based URL monitor as fallback for SPA navigation
let urlObserver = null; // MutationObserver for URL changes

/**
 * Check if extension context is valid
 * @returns {boolean} True if context is valid
 */
function isExtensionContextValid() {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.runtime &&
    typeof chrome.runtime.id === "string" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

/**
 * Get refiner model selection from storage result
 * Priority: custom model > recommended model > default
 * @param {Object} result - Storage result object
 * @returns {string} Selected model
 */
function getRefinerModelSelection(result) {
  const customModel = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
  const recommendedModel = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]?.trim();
  return (
    (customModel && customModel.length > 0 ? customModel : null) ||
    (recommendedModel && recommendedModel.length > 0 ? recommendedModel : null) ||
    DEFAULTS.MODEL_REFINER
  );
}

/**
 * Check if auto-generation should be triggered and trigger it if conditions are met
 * @param {string} videoId - Video ID
 * @param {Object} storageResult - Storage result with API keys and settings
 * @param {boolean} checkCaptionsEnabled - Whether to check if captions are enabled
 * @param {boolean} withDelay - Whether to add a delay before triggering (for initial page load)
 */
function checkAndTriggerAutoGeneration(videoId, storageResult, checkCaptionsEnabled = true, withDelay = false) {
  // Check if auto-generation is enabled
  if (storageResult[STORAGE_KEYS.AUTO_GENERATE] !== true) {
    debugLog("Auto-gen skipped: setting disabled");
    return false;
  }

  // Check if captions are enabled (if required)
  if (checkCaptionsEnabled && !showSubtitlesEnabled) {
    debugLog("Auto-gen skipped: captions disabled");
    return false;
  }

  // Check if API key is available
  if (!storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]) {
    debugLog("Auto-gen skipped: missing Scrape Creators key");
    return false;
  }

  // Check if already triggered for this video
  if (autoGenerationTriggered.has(videoId)) {
    debugLog("Auto-gen skipped: already triggered for video", videoId);
    return false;
  }

  // Mark as triggered
  autoGenerationTriggered.add(videoId);
  debugLog(
    "Auto-gen enabled,",
    withDelay ? "waiting for page to load..." : "triggering immediately...",
    "videoId:",
    videoId
  );

  const trigger = () => {
    const executeTrigger = () => {
      // Double-check video ID hasn't changed
      const currentVideoId = extractVideoId(window.location.href);
      if (currentVideoId !== videoId) {
        debugLog("Auto-gen cancel: video ID changed", videoId, "->", currentVideoId);
        autoGenerationTriggered.delete(videoId);
        return;
      }

      const modelSelection = getRefinerModelSelection(storageResult);
      triggerAutoGeneration(
        videoId,
        storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
        storageResult[STORAGE_KEYS.OPENROUTER_API_KEY],
        modelSelection
      );
    };

    // Double-check captions are still enabled if required
    if (checkCaptionsEnabled) {
      chrome.storage.local.get([STORAGE_KEYS.SHOW_SUBTITLES], (checkResult) => {
        const captionsStillEnabled = checkResult[STORAGE_KEYS.SHOW_SUBTITLES] !== false;

        if (!captionsStillEnabled) {
          debugLog("Auto-gen cancel: captions disabled");
          autoGenerationTriggered.delete(videoId);
          return;
        }

        executeTrigger();
      });
    } else {
      // No caption check needed, trigger directly
      executeTrigger();
    }
  };

  if (withDelay) {
    setTimeout(() => {
      if (!isExtensionContextValid()) {
        debugLog("Context invalidated before auto-generation, aborting.");
        autoGenerationTriggered.delete(videoId);
        return;
      }
      debugLog("Auto-gen delay elapsed; triggering now for", videoId);
      trigger();
    }, TIMING.AUTO_GENERATION_DELAY_MS);
  } else {
    trigger();
  }

  return true;
}

/**
 * Load stored subtitles for the current video from local storage
 * Also checks for auto-generation setting and triggers generation if enabled
 */
function loadStoredSubtitles() {
  try {
    if (!isExtensionContextValid()) {
      logWarn("Extension context invalidated, skipping subtitle load.");
      return;
    }

    // Only proceed if we're on a YouTube video page
    if (!window.location.href.includes("youtube.com/watch")) {
      debugLog("Not on a video page, skipping subtitle load.");
      return;
    }

    const videoId = extractVideoId(window.location.href);
    if (!videoId) {
      logWarn("Could not extract video ID, skipping subtitle load.");
      return;
    }

    const keysToFetch = [
      videoId,
      STORAGE_KEYS.AUTO_GENERATE,
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
      STORAGE_KEYS.SHOW_SUBTITLES,
    ];

    chrome.storage.local.get(keysToFetch, (result) => {
      try {
        if (chrome.runtime.lastError) {
          if (
            chrome.runtime.lastError.message &&
            chrome.runtime.lastError.message.includes("Extension context invalidated")
          ) {
            debugLog("Subtitle load aborted - extension context invalidated.");
            return;
          }
          logError("Error loading subtitles from storage:", chrome.runtime.lastError.message);
          return;
        }

        // Update show subtitles setting
        showSubtitlesEnabled = result[STORAGE_KEYS.SHOW_SUBTITLES] !== false;

        if (result && result[videoId]) {
          debugLog("Found stored subtitles for this video.");
          currentSubtitles = result[videoId];
          if (showSubtitlesEnabled) {
            startSubtitleDisplay();
          }
        } else {
          debugLog("No stored subtitles found for this video.");
          // Try to trigger auto-generation if conditions are met
          checkAndTriggerAutoGeneration(videoId, result, true, true);
        }
      } catch (error) {
        logError("Error processing stored subtitles:", error);
      }
    });
  } catch (error) {
    if (error && error.message && error.message.includes("Extension context invalidated")) {
      debugLog("Subtitle load aborted - extension context invalidated (outer).");
      return;
    }
    logError("Error in loadStoredSubtitles:", error);
  }
}

/**
 * Trigger automatic subtitle generation
 * @param {string} videoId - Video ID
 * @param {string} scrapeCreatorsApiKey - Scrape Creators API key
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {string} modelSelection - Model selection
 */
function triggerAutoGeneration(videoId, scrapeCreatorsApiKey, openRouterApiKey, modelSelection) {
  clearSubtitles();

  debugLog("Sending fetchSubtitles message to background...", {
    action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
    videoId: videoId,
    hasScrapeKey: !!scrapeCreatorsApiKey,
    hasOpenRouterKey: !!openRouterApiKey,
    modelSelection: modelSelection,
  });

  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
      videoId: videoId,
      scrapeCreatorsApiKey: scrapeCreatorsApiKey,
      openRouterApiKey: openRouterApiKey,
      modelSelection: modelSelection,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        logError("Error triggering auto-generation:", chrome.runtime.lastError.message);
        autoGenerationTriggered.delete(videoId);
      } else {
        debugLog("Auto-generation triggered successfully, response:", response);
      }
    }
  );
}

/**
 * Monitor URL changes on YouTube (SPA behavior)
 */
function monitorUrlChanges() {
  // Disconnect existing observer if any
  if (urlObserver) {
    urlObserver.disconnect();
    urlObserver = null;
  }

  urlObserver = new MutationObserver(() => {
    // Stop monitoring if extension context is invalidated
    if (!isExtensionContextValid()) {
      if (urlObserver) {
        urlObserver.disconnect();
        urlObserver = null;
      }
      return;
    }

    if (currentUrl !== window.location.href) {
      debugLog("URL changed (mutation).");
      const oldVideoId = extractVideoId(currentUrl);
      currentUrl = window.location.href;
      const newVideoId = extractVideoId(currentUrl);

      // If video ID changed, clear the auto-generation tracking for the old video
      if (oldVideoId !== newVideoId) {
        autoGenerationTriggered.delete(oldVideoId);
      }

      onUrlChange();
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Handle actions when the URL changes
 */
function onUrlChange() {
  debugLog("Reinitializing for new video...");
  clearSubtitles();
  initAttempts = 0;
  initialize();
}

/**
 * Find video elements on the YouTube page
 * @returns {boolean} True if video elements found
 */
function findVideoElements() {
  videoPlayer = document.querySelector(YOUTUBE.SELECTORS.VIDEO_PLAYER);
  if (!videoPlayer) return false;

  // Try finding a standard container, fallback to player's parent
  videoContainer =
    document.querySelector(YOUTUBE.SELECTORS.MOVIE_PLAYER) ||
    document.querySelector(YOUTUBE.SELECTORS.VIDEO_CONTAINER) ||
    videoPlayer.parentElement;

  return !!videoContainer;
}

/**
 * Initialize the content script
 */
function initialize() {
  debugLog("Initializing content script...");

  // Only initialize on YouTube video pages
  if (!window.location.href.includes("youtube.com/watch")) {
    debugLog("Not on a video page, skipping initialization.");
    return;
  }

  if (!findVideoElements()) {
    initAttempts++;
    if (initAttempts < TIMING.MAX_INIT_ATTEMPTS) {
      debugLog(`Video player not found, retrying (${initAttempts}/${TIMING.MAX_INIT_ATTEMPTS})...`);
      setTimeout(initialize, TIMING.INIT_RETRY_DELAY_MS);
    } else {
      logError("Video player or container not found after multiple attempts.");
    }
    return;
  }

  debugLog("Video player found.", videoPlayer);
  debugLog("Video container found.", videoContainer);

  createSubtitleElements();
  loadStoredSubtitles();
  loadCaptionFontSize();
  setupMessageListener();
}

/**
 * Setup message listener for content script
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.GET_VIDEO_TITLE) {
      const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string");
      const title = titleElement ? titleElement.textContent : null;
      sendResponse({ title: title });
      return true;
    } else if (message.action === MESSAGE_ACTIONS.GENERATE_SUMMARY) {
      handleGenerateSummary(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.GENERATE_SUBTITLES) {
      handleGenerateSubtitles(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.SUBTITLES_GENERATED) {
      handleSubtitlesGenerated(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.TOGGLE_SUBTITLES) {
      handleToggleSubtitles(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_CAPTION_FONT_SIZE) {
      handleUpdateCaptionFontSize(message, sendResponse);
      return true;
    }
  });
}

/**
 * Handle generate summary request
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleGenerateSummary(message, sendResponse) {
  debugLog("Received generateSummary request");

  const videoId = message.videoId || extractVideoId(window.location.href);

  if (!videoId) {
    sendResponse({
      status: "error",
      message: "Could not extract video ID from URL.",
    });
    return;
  }

  debugLog("Requesting summary from background for video:", videoId);

  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.GENERATE_SUMMARY,
      videoId: videoId,
      scrapeCreatorsApiKey: message.scrapeCreatorsApiKey,
      openRouterApiKey: message.openRouterApiKey,
      modelSelection: message.modelSelection,
      targetLanguage: message.targetLanguage,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        logError("Error sending message to background:", chrome.runtime.lastError);
        sendResponse({
          status: "error",
          message: "Could not communicate with background script.",
        });
      } else {
        debugLog("Summary request sent to background, response:", response);
      }
    }
  );

  sendResponse({ status: "started" });
}

/**
 * Handle generate subtitles request
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleGenerateSubtitles(message, sendResponse) {
  debugLog("Received generateSubtitles request");

  const videoId = message.videoId || extractVideoId(window.location.href);

  if (!videoId) {
    sendResponse({
      status: "error",
      message: "Could not extract video ID from URL.",
    });
    return;
  }

  debugLog("Sending video ID to background:", videoId);

  clearSubtitles();

  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
      videoId: videoId,
      scrapeCreatorsApiKey: message.scrapeCreatorsApiKey,
      openRouterApiKey: message.openRouterApiKey,
      modelSelection: message.modelSelection,
      forceRegenerate: message.forceRegenerate === true,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        logError("Error sending message to background:", chrome.runtime.lastError);
        sendResponse({
          status: "error",
          message: "Could not communicate with background script.",
        });
      } else {
        debugLog("Message sent to background, response:", response);
        if (response?.status === "error") {
          autoGenerationTriggered.delete(videoId);
        }
      }
    }
  );

  sendResponse({ status: "started" });
}

/**
 * Handle subtitles generated message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleSubtitlesGenerated(message, sendResponse) {
  debugLog("Received subtitlesGenerated request");
  currentSubtitles = message.subtitles || [];
  debugLog(`Received ${currentSubtitles.length} subtitle entries.`);

  if (currentSubtitles.length > 0) {
    if (showSubtitlesEnabled) {
      startSubtitleDisplay();
    }

    // Store the subtitles locally
    const videoId = message.videoId || extractVideoId(window.location.href);

    if (videoId) {
      chrome.storage.local.set({ [videoId]: currentSubtitles }, () => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("QUOTA")) {
            logWarn("Storage quota exceeded. Transcript will not be saved, but subtitles will still display.");
          } else {
            logError("Error saving subtitles:", chrome.runtime.lastError.message);
          }
        } else {
          debugLog("Subtitles saved to local storage for video ID:", videoId);
        }
      });
    } else {
      logWarn("Could not extract video ID, subtitles not saved.");
    }

    sendResponse({ status: "success" });
  } else {
    logWarn("Received empty subtitles array.");
    clearSubtitles();
    sendResponse({ status: "no_subtitles_found" });
  }
}

/**
 * Load and apply caption font size from storage
 */
function loadCaptionFontSize() {
  try {
    if (!isExtensionContextValid()) {
      debugLog("Context invalidated, skipping font size load.");
      return;
    }

    chrome.storage.local.get([STORAGE_KEYS.CAPTION_FONT_SIZE], (result) => {
      try {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || "";
          if (errorMsg.includes("Extension context invalidated")) {
            debugLog("Font size load aborted - extension context invalidated.");
            return;
          }
          logWarn("Error loading caption font size:", errorMsg);
          return;
        }

        const fontSize = result?.[STORAGE_KEYS.CAPTION_FONT_SIZE] || DEFAULTS.CAPTION_FONT_SIZE;
        applyCaptionFontSize(fontSize);
      } catch (error) {
        if (error?.message?.includes("Extension context invalidated")) {
          debugLog("Font size load aborted (callback) - extension context invalidated.");
          return;
        }
        logError("Error applying caption font size:", error);
      }
    });
  } catch (error) {
    if (error?.message?.includes("Extension context invalidated")) {
      debugLog("Font size load aborted (outer) - extension context invalidated.");
      return;
    }
    logError("Error in loadCaptionFontSize:", error);
  }
}

/**
 * Apply caption font size
 * @param {string} size - Size key (S, M, L)
 */
function applyCaptionFontSize(size) {
  const sizeConfig = FONT_SIZES.CAPTION[size] || FONT_SIZES.CAPTION.M;
  
  // Update CSS custom properties for consistency
  document.documentElement.style.setProperty("--caption-font-size-base", sizeConfig.base);
  document.documentElement.style.setProperty("--caption-font-size-max", sizeConfig.max);
  document.documentElement.style.setProperty("--caption-font-size-min", sizeConfig.min);
  document.documentElement.style.setProperty("--caption-font-size-fullscreen", sizeConfig.fullscreen);
  document.documentElement.style.setProperty("--caption-font-size-fullscreen-max", sizeConfig.fullscreenMax);

  // Apply to element directly if it exists, using clamp for responsiveness
  if (subtitleText) {
    subtitleText.style.fontSize = `clamp(${sizeConfig.min}, ${sizeConfig.base}, ${sizeConfig.max})`;
  }
}

/**
 * Handle update caption font size message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleUpdateCaptionFontSize(message, sendResponse) {
  const fontSize = message.fontSize || DEFAULTS.CAPTION_FONT_SIZE;
  applyCaptionFontSize(fontSize);
  sendResponse({ status: "success" });
}

/**
 * Handle toggle subtitles message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleToggleSubtitles(message, sendResponse) {
  debugLog("Received toggleSubtitles request");
  const hasShowSubtitles = Object.prototype.hasOwnProperty.call(message, "showSubtitles");
  const hasEnabled = Object.prototype.hasOwnProperty.call(message, "enabled");
  const nextState = hasShowSubtitles
    ? message.showSubtitles !== false
    : hasEnabled
    ? message.enabled !== false
    : true;
  const wasEnabled = showSubtitlesEnabled;
  showSubtitlesEnabled = nextState;
  chrome.storage.local.set({ [STORAGE_KEYS.SHOW_SUBTITLES]: showSubtitlesEnabled });

  if (showSubtitlesEnabled && currentSubtitles.length > 0) {
    startSubtitleDisplay();
  } else {
    stopSubtitleDisplay();
    hideCurrentSubtitle();
  }

  // If captions were just turned on and there are no subtitles, check for auto-generation
  if (showSubtitlesEnabled && !wasEnabled && currentSubtitles.length === 0) {
    const videoId = extractVideoId(window.location.href);
    if (videoId) {
      chrome.storage.local.get(
        [
          videoId,
          STORAGE_KEYS.AUTO_GENERATE,
          STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
          STORAGE_KEYS.OPENROUTER_API_KEY,
          STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
          STORAGE_KEYS.REFINER_CUSTOM_MODEL,
        ],
        (result) => {
          // Check if subtitles already exist for this video
          if (result[videoId] && result[videoId].length > 0) {
            debugLog("Subtitles already exist for this video, loading them...");
            currentSubtitles = result[videoId];
            startSubtitleDisplay();
            return;
          }

          // Try to trigger auto-generation (no delay, captions already enabled)
          checkAndTriggerAutoGeneration(videoId, result, false, false);
        }
      );
    }
  }

  sendResponse({ status: "success" });
}

/**
 * Create subtitle elements and append them to the video container
 */
function createSubtitleElements() {
  if (document.getElementById(ELEMENT_IDS.SUBTITLE_CONTAINER)) return;

  subtitleContainer = document.createElement("div");
  subtitleContainer.id = ELEMENT_IDS.SUBTITLE_CONTAINER;
  subtitleContainer.style.position = "absolute";
  subtitleContainer.style.zIndex = "9999";
  subtitleContainer.style.pointerEvents = "none";
  subtitleContainer.style.display = "none";

  subtitleText = document.createElement("div");
  subtitleText.id = ELEMENT_IDS.SUBTITLE_TEXT;
  subtitleContainer.appendChild(subtitleText);

  if (videoContainer) {
    if (getComputedStyle(videoContainer).position === "static") {
      videoContainer.style.position = "relative";
    }
    videoContainer.appendChild(subtitleContainer);
    debugLog("Subtitle container added to video container.");
  } else {
    logError("Cannot add subtitle container, video container not found.");
  }
}

/**
 * Start displaying subtitles
 */
function startSubtitleDisplay() {
  if (!videoPlayer || !subtitleContainer) {
    logWarn("Cannot start subtitle display: Player or container missing.");
    return;
  }

  stopSubtitleDisplay();

  debugLog("Starting subtitle display interval.");
  checkInterval = setInterval(updateSubtitles, TIMING.SUBTITLE_UPDATE_INTERVAL_MS);

  videoPlayer.addEventListener("play", updateSubtitles);
  videoPlayer.addEventListener("seeked", updateSubtitles);
}

/**
 * Stop displaying subtitles
 */
function stopSubtitleDisplay() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    debugLog("Stopped subtitle display interval.");
  }
  if (videoPlayer) {
    videoPlayer.removeEventListener("play", updateSubtitles);
    videoPlayer.removeEventListener("seeked", updateSubtitles);
  }
}

/**
 * Clear subtitles and stop display
 */
function clearSubtitles() {
  currentSubtitles = [];
  stopSubtitleDisplay();
  hideCurrentSubtitle();
  debugLog("Subtitles cleared.");
}

/**
 * Hide the current subtitle
 */
function hideCurrentSubtitle() {
  if (subtitleContainer) {
    subtitleContainer.style.display = "none";
  }
  if (subtitleText) {
    subtitleText.textContent = "";
  }
}

/**
 * Update subtitles based on the current video time
 */
function updateSubtitles() {
  if (!videoPlayer || !subtitleText || !subtitleContainer) {
    return;
  }

  if (isNaN(videoPlayer.currentTime)) return;

  const currentTime = videoPlayer.currentTime * 1000; // Convert to ms
  let foundSubtitle = null;

  for (const subtitle of currentSubtitles) {
    if (currentTime >= subtitle.startTime && currentTime <= subtitle.endTime) {
      foundSubtitle = subtitle;
      break;
    }
  }

  if (foundSubtitle) {
    if (subtitleText.textContent !== foundSubtitle.text) {
      subtitleText.textContent = foundSubtitle.text;
    }
    subtitleContainer.style.display = "block";
  } else {
    hideCurrentSubtitle();
  }
}

// Initialize immediately since we're using document_end in manifest
(function() {
  debugLog("Content script loaded, readyState:", document.readyState);
  
  const startInitialization = () => {
    initialize();
    monitorUrlChanges();
  };
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startInitialization);
  } else {
    // Give YouTube a moment to render if we're already loaded
    setTimeout(startInitialization, 500);
  }
})();

