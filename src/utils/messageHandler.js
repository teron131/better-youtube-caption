/**
 * Message Handler for Side Panel
 * Handles messages from background and content scripts
 */

import { MESSAGE_ACTIONS, STORAGE_KEYS, TIMING } from "../constants.js";
import { isModelError } from "./errorHandling.js";
import { checkRefinedCaptionsAvailability } from "./generation.js";
import { displaySummary } from "./ui.js";

/**
 * Handle model error by clearing invalid custom models
 * @param {Object} elements - DOM elements
 * @param {string} errorMessage - Error message
 */
function handleModelError(elements, errorMessage) {
  const clears = {};
  let clearedCount = 0;

  if (elements.summarizerCustomModel?.value.trim()) {
    elements.summarizerCustomModel.value = "";
    clears[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] = "";
    clearedCount++;
  }

  if (elements.refinerCustomModel?.value.trim()) {
    elements.refinerCustomModel.value = "";
    clears[STORAGE_KEYS.REFINER_CUSTOM_MODEL] = "";
    clearedCount++;
  }

  if (Object.keys(clears).length > 0) {
    chrome.storage.local.set(clears, () => {
      console.log("Sidepanel: Cleared invalid custom models");
    });

    alert(
      `Model Error: ${errorMessage}\n\n` +
        `Invalid custom model input detected and cleared. ` +
        `Now using recommended models for summarizer and refiner. ` +
        `Please check your custom model entries if needed.`
    );
  } else {
    alert(
      `Model Error: ${errorMessage}\n\n` +
        `Please check your model selection in Settings and ensure it's a valid OpenRouter model ID.`
    );
  }
}

/**
 * Handle error message
 * @param {Object} message - Message object
 * @param {Object} elements - DOM elements
 */
function handleErrorMessage(message, elements) {
  elements.status.className = "status error";

  const errorString =
    typeof message.error === "string"
      ? message.error
      : message.error?.message || JSON.stringify(message.error) || "Unknown error";
  const isModel = isModelError(message.error);

  if (isModel && (elements.summarizerCustomModel || elements.refinerCustomModel)) {
    handleModelError(elements, errorString);
  } else if (isModel) {
    alert(
      `Model Error: ${errorString}\n\n` +
        `Please check your model selection in Settings and ensure it's a valid OpenRouter model ID.`
    );
  } else {
    elements.status.textContent = `Error: ${errorString}`;
  }
}

/**
 * Handle status update message
 * @param {Object} message - Message object
 * @param {Object} elements - DOM elements
 */
function handleStatusUpdate(message, elements) {
  if (message.error) {
    elements.status.className = "status error";
    elements.generateSummaryBtn.disabled = false;
    elements.generateCaptionBtn.disabled = false;
    elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';

    const errorString =
      typeof message.error === "string"
        ? message.error
        : message.error?.message || JSON.stringify(message.error) || "Unknown error";
    const isModel = isModelError(message.error);

    if (isModel && (elements.summarizerCustomModel || elements.refinerCustomModel)) {
      handleModelError(elements, errorString);
    } else {
      elements.status.textContent = message.text || `Error: ${errorString}`;
    }
  } else if (message.success) {
    elements.status.className = "status success";
    elements.generateSummaryBtn.disabled = false;
    elements.generateCaptionBtn.disabled = false;
    // Check if refined captions are now available (for copy button)
    checkRefinedCaptionsAvailability(elements.copyCaptionBtn);
  } else {
    elements.status.textContent = message.text;
    // Also check when status updates (captions might have been generated)
    if (message.text && (message.text.includes("ready") || message.text.includes("complete") || message.text.includes("success"))) {
      // Small delay to ensure storage is updated
      setTimeout(() => {
        checkRefinedCaptionsAvailability(elements.copyCaptionBtn);
      }, TIMING.CAPTION_CHECK_DELAY_MS);
    }
  }
}

/**
 * Handle summary generated message
 * @param {Object} message - Message object
 * @param {Object} elements - DOM elements
 */
function handleSummaryGenerated(message, elements) {
  if (message.summary) {
    displaySummary(message.summary, elements.summaryContent);
    elements.status.textContent = "Summary generated successfully!";
    elements.status.className = "status success";

    setTimeout(() => {
      elements.status.textContent = "";
      elements.status.className = "status";
    }, TIMING.SUMMARY_SUCCESS_DISPLAY_MS);
  }
  elements.generateSummaryBtn.disabled = false;
  elements.generateCaptionBtn.disabled = false;
}

/**
 * Setup message listener for side panel
 * @param {Object} elements - DOM elements
 */
export function setupMessageListener(elements) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.SHOW_ERROR) {
      handleErrorMessage(message, elements);
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      handleStatusUpdate(message, elements);
    } else if (message.action === "SUMMARY_GENERATED") {
      handleSummaryGenerated(message, elements);
    }
  });
}
