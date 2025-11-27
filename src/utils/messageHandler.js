/**
 * Message Handler for Popup
 * Handles messages from background and content scripts
 */

import { MESSAGE_ACTIONS, STORAGE_KEYS } from "../constants.js";
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

  if (elements.summarizerCustomModel && elements.summarizerCustomModel.value.trim()) {
    elements.summarizerCustomModel.value = '';
    clears[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] = '';
    clearedCount++;
  }

  if (elements.refinerCustomModel && elements.refinerCustomModel.value.trim()) {
    elements.refinerCustomModel.value = '';
    clears[STORAGE_KEYS.REFINER_CUSTOM_MODEL] = '';
    clearedCount++;
  }

  if (Object.keys(clears).length > 0) {
    chrome.storage.local.set(clears, () => {
      console.log('Popup: Cleared invalid custom models');
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
 * Safely convert error to string and lowercase
 * @param {*} error - Error (can be string, object, array, etc.)
 * @returns {string} Lowercased error string
 */
function errorToString(error) {
  if (typeof error === 'string') {
    return error.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === 'object' && error !== null) {
    // Try to extract meaningful error message from object
    if (error.message) {
      return String(error.message).toLowerCase();
    }
    if (error.error) {
      return errorToString(error.error);
    }
    // Fallback: stringify the object
    return JSON.stringify(error).toLowerCase();
  }
  return String(error).toLowerCase();
}

/**
 * Check if error is a model-related error
 * @param {*} error - Error message (can be string, object, etc.)
 * @returns {boolean} True if model error
 */
function isModelError(error) {
  const lowerError = errorToString(error);
  return (
    lowerError.includes('invalid model') ||
    lowerError.includes('not a valid model id') ||
    lowerError.includes('model not found') ||
    lowerError.includes('openrouter')
  );
}

/**
 * Setup message listener for popup
 * @param {Object} elements - DOM elements
 */
export function setupMessageListener(elements) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.SHOW_ERROR) {
      elements.status.className = 'status error';
      
      const errorString = typeof message.error === 'string' 
        ? message.error 
        : (message.error?.message || JSON.stringify(message.error) || 'Unknown error');
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
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      if (message.error) {
        elements.status.className = 'status error';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
        elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
        
        const errorString = typeof message.error === 'string' 
          ? message.error 
          : (message.error?.message || JSON.stringify(message.error) || 'Unknown error');
        const isModel = isModelError(message.error);
        
        if (isModel && (elements.summarizerCustomModel || elements.refinerCustomModel)) {
          handleModelError(elements, errorString);
        } else {
          elements.status.textContent = message.text || `Error: ${errorString}`;
        }
      } else if (message.success) {
        elements.status.className = 'status success';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
        // Check if refined captions are now available (for copy button)
        checkRefinedCaptionsAvailability(elements.copyCaptionBtn);
      } else {
        elements.status.textContent = message.text;
        // Also check when status updates (captions might have been generated)
        if (message.text && (message.text.includes('ready') || message.text.includes('complete') || message.text.includes('success'))) {
          // Small delay to ensure storage is updated
          setTimeout(() => {
            checkRefinedCaptionsAvailability(elements.copyCaptionBtn);
          }, 500);
        }
      }
    } else if (message.action === 'SUMMARY_GENERATED') {
      if (message.summary) {
        displaySummary(message.summary, elements.summaryContent);
        elements.status.textContent = 'Summary generated successfully!';
        elements.status.className = 'status success';
        
        // Note: Summary is already saved by background script, no need to save again here
        
        setTimeout(() => {
          elements.status.textContent = '';
          elements.status.className = 'status';
        }, 3000);
      }
      elements.generateSummaryBtn.disabled = false;
      elements.generateCaptionBtn.disabled = false;
    }
  });
}

