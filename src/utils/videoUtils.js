/**
 * Video Utilities
 * Centralized video ID extraction and validation
 */

import { extractVideoId } from "../url.js";

/**
 * Get current YouTube video tab
 * @returns {Promise<chrome.tabs.Tab|null>} Current tab or null
 */
export async function getCurrentVideoTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab?.url?.includes("youtube.com/watch")) {
        resolve(currentTab);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Get video ID from current tab
 * @returns {Promise<string|null>} Video ID or null
 */
export async function getVideoIdFromCurrentTab() {
  const tab = await getCurrentVideoTab();
  if (!tab?.url) return null;
  return extractVideoId(tab.url);
}

/**
 * Validate video ID and return error message if invalid
 * @param {string} videoId - Video ID to validate
 * @returns {Object} Validation result with isValid flag and error message
 */
export function validateVideoId(videoId) {
  if (!videoId) {
    return {
      isValid: false,
      error: "Could not extract video ID from URL.",
    };
  }
  return { isValid: true, error: null };
}

/**
 * Get video ID from URL with validation
 * @param {string} url - URL to extract video ID from
 * @returns {Object} Result with videoId and error
 */
export function getVideoIdFromUrl(url) {
  const videoId = extractVideoId(url);
  const validation = validateVideoId(videoId);
  return {
    videoId,
    ...validation,
  };
}

