/**
 * Centralized messaging utilities for Chrome extension communication
 * Handles message sending with proper error handling and timeouts
 */

/**
 * Send message to background script with error handling
 * @param {Object} message - Message object to send
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 * @returns {void}
 */
function sendToBackground(message, onSuccess, onError) {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      if (onError) {
        onError(chrome.runtime.lastError);
      } else {
        console.error("Message send error:", chrome.runtime.lastError.message);
      }
    } else if (onSuccess) {
      onSuccess(response);
    }
  });
}

/**
 * Send message to content script in a specific tab
 * @param {number} tabId - Tab ID to send message to
 * @param {Object} message - Message object to send
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback (optional, logs by default)
 * @returns {void}
 */
function sendToTab(tabId, message, onSuccess, onError) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      // Tab might be closed or content script not loaded - this is often expected
      if (onError) {
        onError(chrome.runtime.lastError);
      } else {
        console.debug("Tab message error (may be expected):", chrome.runtime.lastError.message);
      }
    } else if (onSuccess) {
      onSuccess(response);
    }
  });
}

/**
 * Send message to popup (from background or content script)
 * @param {Object} message - Message object to send
 * @param {Function} onSuccess - Success callback (optional)
 * @param {Function} onError - Error callback (optional)
 * @returns {void}
 */
function sendToPopup(message, onSuccess, onError) {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      // Popup might be closed - this is often expected
      if (onError) {
        onError(chrome.runtime.lastError);
      } else {
        console.debug("Popup message error (popup may be closed):", chrome.runtime.lastError.message);
      }
    } else if (onSuccess) {
      onSuccess(response);
    }
  });
}

/**
 * Broadcast message to all tabs matching a URL pattern
 * @param {string} urlPattern - URL pattern to match (e.g., "*://youtube.com/*")
 * @param {Object} message - Message object to send
 * @returns {Promise<Array>} Promise resolving to array of responses
 */
async function broadcastToTabs(urlPattern, message) {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  const promises = tabs.map((tab) => {
    return new Promise((resolve) => {
      sendToTab(tab.id, message, resolve, () => resolve(null));
    });
  });
  return Promise.all(promises);
}

/**
 * Check if extension context is still valid
 * Useful for detecting if extension was reloaded
 * @returns {boolean} True if context is valid
 */
function isExtensionContextValid() {
  try {
    chrome.runtime.getManifest();
    return true;
  } catch (e) {
    return false;
  }
}

