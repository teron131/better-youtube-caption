/**
 * Message Utilities
 * Centralized message sending and status updates
 */

import { MESSAGE_ACTIONS } from "../constants.js";

/**
 * Send status update to sidepanel
 * @param {number|null} tabId - Tab ID
 * @param {string} text - Status text
 * @param {boolean} success - Success flag
 * @param {boolean} error - Error flag
 */
export function sendStatusUpdate(tabId, text, success = false, error = false) {
  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
      text: text,
      success: success,
      error: error,
      tabId: tabId,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Sidepanel might be closed, ignore
      }
    }
  );
}

/**
 * Send error to sidepanel
 * @param {number|null} tabId - Tab ID
 * @param {string} errorMessage - Error message
 */
export function sendError(tabId, errorMessage) {
  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.SHOW_ERROR,
      error: errorMessage,
      tabId: tabId,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Sidepanel might be closed, ignore
      }
    }
  );
}

/**
 * Send message to content script
 * @param {number} tabId - Tab ID
 * @param {Object} message - Message object
 * @returns {Promise<Object>} Response from content script
 */
export function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Send subtitles generated message to content script
 * @param {number|null} tabId - Tab ID
 * @param {Array} subtitles - Subtitle segments
 * @param {string} videoId - Video ID
 */
export function sendSubtitlesGenerated(tabId, subtitles, videoId) {
  if (!tabId) return;

  chrome.tabs.sendMessage(
    tabId,
    {
      action: MESSAGE_ACTIONS.SUBTITLES_GENERATED,
      subtitles: subtitles,
      videoId: videoId,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.log(
          "Could not send message to tab (tab may be closed):",
          chrome.runtime.lastError.message
        );
      }
    }
  );
}

/**
 * Send summary generated message
 * @param {number|null} tabId - Tab ID
 * @param {string} summary - Summary text
 * @param {string} videoId - Video ID
 */
export function sendSummaryGenerated(tabId, summary, videoId) {
  const message = {
    action: "SUMMARY_GENERATED",
    summary: summary,
    videoId: videoId,
    tabId: tabId || null,
  };

  if (tabId) {
    chrome.tabs.sendMessage(tabId, message);
  }
  chrome.runtime.sendMessage(message);
}

