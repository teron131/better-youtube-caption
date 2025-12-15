/**
 * Extension Context Validation
 * Utilities for checking if extension context is still valid
 */

/**
 * Get extension URL or fallback for non-extension context
 * @returns {string} Extension URL
 */
export function getExtensionUrl() {
  return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL("")
    : "https://github.com/better-youtube-caption";
}

/**
 * Check if extension context is valid
 * @returns {boolean} True if context is valid
 */
export function isExtensionContextValid() {
  return (
    typeof chrome !== "undefined" &&
    !!chrome.runtime &&
    typeof chrome.runtime.id === "string" &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

/**
 * Check if Chrome runtime error indicates context invalidation
 * @param {chrome.runtime.LastError} lastError - Chrome runtime last error
 * @returns {boolean} True if context invalidated
 */
export function isContextInvalidated(lastError) {
  return (
    lastError?.message?.toLowerCase().includes("extension context invalidated")
  );
}

/**
 * Wrap storage callback with context validation
 * @param {Function} callback - Callback to wrap
 * @returns {Function} Wrapped callback
 */
export function withContextValidation(callback) {
  return function (...args) {
    if (!isExtensionContextValid()) {
      console.log("Extension context invalidated, skipping operation.");
      return;
    }
    return callback(...args);
  };
}

