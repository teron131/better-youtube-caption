/**
 * Generation Actions
 * Handles summary and caption generation requests
 */

import { MESSAGE_ACTIONS, STORAGE_KEYS } from "../constants.js";
import { getStoredSubtitles } from "../storage.js";
import { extractVideoId } from "../url.js";
import { getRefinerModel, getSummarizerModel, getTargetLanguage } from "./sidepanelSettings.js";
import { getCurrentVideoTab, getVideoIdFromCurrentTab, validateVideoId } from "./videoUtils.js";
import { validateApiKeys } from "./apiValidation.js";

/**
 * Check if refined captions exist for current video and update copy button state
 * @param {HTMLElement} copyCaptionBtn - Copy button element
 */
export async function checkRefinedCaptionsAvailability(copyCaptionBtn) {
  if (!copyCaptionBtn) return;

  try {
    const videoId = await getVideoIdFromCurrentTab();
    if (!videoId) {
      copyCaptionBtn.disabled = true;
      return;
    }

    const subtitles = await getStoredSubtitles(videoId);
    copyCaptionBtn.disabled = !subtitles || !Array.isArray(subtitles) || subtitles.length === 0;
  } catch (error) {
    console.error("Error checking refined captions:", error);
    copyCaptionBtn.disabled = true;
  }
}

/**
 * Show error in status element
 */
function showError(statusElement, message) {
  statusElement.textContent = message;
  statusElement.className = "status error";
}

/**
 * Validate API keys and show error if missing
 * @param {Object} result - Storage result
 * @param {HTMLElement} statusElement - Status element to show errors
 * @param {Function} showSettingsView - Function to show settings view
 * @returns {boolean} True if valid
 */
function validateApiKeysForGeneration(result, statusElement, showSettingsView) {
  const validation = validateApiKeys(result);
  if (!validation.isValid) {
    showError(statusElement, `Please enter ${validation.missingKeys[0]} in Settings`);
    showSettingsView();
    return false;
  }
  return true;
}

/**
 * Get video ID from current tab with validation
 * @param {HTMLElement} statusElement - Status element to show errors
 * @returns {Promise<Object|null>} {videoId, tabId} or null
 */
async function getValidatedVideoId(statusElement) {
  const currentTab = await getCurrentVideoTab();
  if (!currentTab) {
    showError(statusElement, "Not a YouTube video page");
    return null;
  }

  const videoId = extractVideoId(currentTab.url);
  const validation = validateVideoId(videoId);
  if (!validation.isValid) {
    showError(statusElement, validation.error);
    return null;
  }

  return { videoId, tabId: currentTab.id };
}

/**
 * Set loading state for generation buttons
 * @param {Object} elements - DOM elements
 * @param {boolean} isLoading - Whether buttons should be disabled
 */
function setGenerationLoadingState(elements, isLoading) {
  elements.generateSummaryBtn.disabled = isLoading;
  elements.generateCaptionBtn.disabled = isLoading;
}

/**
 * Handle summary generation response
 */
function handleSummaryResponse(elements, response) {
  if (chrome.runtime.lastError) {
    showError(elements.status, "Error: " + chrome.runtime.lastError.message);
    setGenerationLoadingState(elements, false);
    elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
    return;
  }

  if (response?.status === "started") {
    elements.status.textContent = "Processing video transcript...";
  } else if (response?.status === "error") {
    const errorMsg = response.message || "Unknown error";
    showError(elements.status, "Error: " + errorMsg);
    setGenerationLoadingState(elements, false);
    // Don't clear summary content if it's just a "already running" error
    if (!errorMsg.includes("already in progress")) {
      elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
    }
  }
}

/**
 * Generate summary for current video
 * @param {Object} elements - DOM elements
 * @param {Function} showSettingsView - Function to show settings view
 */
export async function generateSummary(elements, showSettingsView) {
  if (elements.generateSummaryBtn.disabled || elements.generateCaptionBtn.disabled) {
    return;
  }

  elements.status.textContent = "";
  elements.status.className = "status";

  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
      STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL,
      STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED,
      STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM,
    ],
    async (result) => {
      if (!validateApiKeysForGeneration(result, elements.status, showSettingsView)) {
        return;
      }

      // Get models and target language from UI or storage
      const summarizerModel = elements.summarizerInput?.value.trim() || getSummarizerModel(result);
      const targetLanguage = elements.targetLanguageInput?.value.trim() || getTargetLanguage(result);

      // Show loading state
      elements.status.textContent = "Generating summary...";
      setGenerationLoadingState(elements, true);
      elements.summaryContent.innerHTML = '<div class="summary-placeholder">Generating summary, please wait...</div>';

      // Get and validate video ID
      const videoInfo = await getValidatedVideoId(elements.status);
      if (!videoInfo) {
        setGenerationLoadingState(elements, false);
        return;
      }

      const { videoId, tabId } = videoInfo;

      // Send generation request
      chrome.tabs.sendMessage(
        tabId,
        {
          action: MESSAGE_ACTIONS.GENERATE_SUMMARY,
          videoId,
          scrapeCreatorsApiKey: result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
          openRouterApiKey: result[STORAGE_KEYS.OPENROUTER_API_KEY],
          modelSelection: summarizerModel,
          targetLanguage,
        },
        (response) => handleSummaryResponse(elements, response)
      );
    }
  );
}

/**
 * Handle caption generation response
 */
function handleCaptionResponse(elements, response) {
  if (chrome.runtime.lastError) {
    showError(elements.status, "Error: " + chrome.runtime.lastError.message);
    setGenerationLoadingState(elements, false);
    return;
  }

  if (response?.status === "started") {
    elements.status.textContent = "Fetching and refining transcript...";
  } else if (response?.status === "error") {
    showError(elements.status, "Error: " + (response.message || "Unknown error"));
    setGenerationLoadingState(elements, false);
  }
}

/**
 * Generate captions for current video
 * @param {Object} elements - DOM elements
 * @param {Function} showSettingsView - Function to show settings view
 */
export async function generateCaptions(elements, showSettingsView) {
  if (elements.generateSummaryBtn.disabled || elements.generateCaptionBtn.disabled) {
    return;
  }

  elements.status.textContent = "";
  elements.status.className = "status";

  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
    ],
    async (result) => {
      if (!validateApiKeysForGeneration(result, elements.status, showSettingsView)) {
        return;
      }

      const refinerModel = elements.refinerInput?.value.trim() || getRefinerModel(result);

      // Show loading state
      elements.status.textContent = "Generating refined captions...";
      setGenerationLoadingState(elements, true);

      // Get and validate video ID
      const videoInfo = await getValidatedVideoId(elements.status);
      if (!videoInfo) {
        setGenerationLoadingState(elements, false);
        return;
      }

      const { videoId, tabId } = videoInfo;

      // Send generation request
      chrome.tabs.sendMessage(
        tabId,
        {
          action: MESSAGE_ACTIONS.GENERATE_SUBTITLES,
          videoId,
          scrapeCreatorsApiKey: result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
          openRouterApiKey: result[STORAGE_KEYS.OPENROUTER_API_KEY],
          modelSelection: refinerModel,
          forceRegenerate: true,
        },
        (response) => handleCaptionResponse(elements, response)
      );
    }
  );
}
