/**
 * Background Service Worker for Better YouTube Caption Extension
 * Handles message routing and orchestration
 */

import { MESSAGE_ACTIONS } from "./constants.js";
import { handleFetchSubtitles, handleGenerateSummary } from "./utils/backgroundHandlers.js";

/**
 * Main message listener
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background: Received message:', message.action, 'from:', sender.tab ? 'tab' : 'popup');
  
  const tabId = sender.tab?.id;

  if (message.action === MESSAGE_ACTIONS.GENERATE_SUMMARY) {
    handleGenerateSummary(message, tabId, sendResponse);
    return true; // Keep channel open for async response
  } else if (message.action === MESSAGE_ACTIONS.FETCH_SUBTITLES) {
    handleFetchSubtitles(message, tabId, sendResponse);
    return true; // Keep channel open for async response
  }
});

