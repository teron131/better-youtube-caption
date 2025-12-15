/**
 * Background Service Worker for Better YouTube Caption Extension
 * Handles message routing and orchestration
 */

import { MESSAGE_ACTIONS } from "./constants.js";
import { handleFetchSubtitles, handleGenerateSummary } from "./utils/backgroundHandlers.js";

// Allow side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/**
 * Main message listener
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background: Received message:", message.action, "from:", sender.tab ? "tab" : "sidepanel");

  const tabId = sender.tab?.id;
  const handlers = {
    [MESSAGE_ACTIONS.GENERATE_SUMMARY]: handleGenerateSummary,
    [MESSAGE_ACTIONS.FETCH_SUBTITLES]: handleFetchSubtitles,
  };

  const handler = handlers[message.action];
  if (!handler) {
    return;
  }

  handler(message, tabId, sendResponse);
  return true; // Keep channel open for async response
});

