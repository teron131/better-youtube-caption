/**
 * Load existing summary for current video
 * Checks storage and displays summary if found
 */

import { extractVideoId } from "../url.js";
import { getCurrentVideoTab } from "./videoUtils.js";
import { log as logDebug } from "./logger.js";
import { displaySummary } from "./ui.js";

/**
 * Load and display summary for current video
 * @param {Object} elements - DOM elements
 */
export async function loadExistingSummary(elements) {
  try {
    // Get current tab
    const currentTab = await getCurrentVideoTab();
    if (!currentTab) {
      return;
    }

    const videoId = extractVideoId(currentTab.url);
    if (!videoId) {
      return;
    }

    // Check for existing summary
    chrome.storage.local.get([`summary_${videoId}`], (result) => {
      if (result[`summary_${videoId}`] && elements.summaryContent) {
        logDebug('Sidepanel: Found existing summary for video:', videoId);
        displaySummary(result[`summary_${videoId}`], elements.summaryContent);
      }
    });
  } catch (error) {
    logDebug('Sidepanel: Error loading existing summary:', error);
  }
}
