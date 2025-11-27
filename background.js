/**
 * Background Service Worker for Better YouTube Caption Extension
 * Handles message routing and orchestration
 */

// Import utility modules
importScripts('src/constants.js');
importScripts('src/timestampParser.js');
importScripts('src/url.js');
importScripts('src/utils/logger.js');
importScripts('src/storage.js');
// Note: segmentParser.js is included in captionRefiner.bundle.js, no need to load separately
importScripts('dist/captionRefiner.bundle.js');
importScripts('src/transcript.js');
importScripts('dist/captionSummarizer.bundle.js');
importScripts('config.js');
importScripts('dist/opencc.bundle.js');
importScripts('src/utils/backgroundHandlers.js');

/**
 * Get API key with fallback to test config
 * @param {string} keyName - Key name
 * @returns {Promise<string>} API key
 */
async function getApiKeyWithFallback(keyName) {
  const testConfig = getConfig();
  
  // If test config is enabled and has a value, use it
  if (testConfig.useTestConfig && testConfig[keyName]) {
    console.log(`Using test config for ${keyName}`);
    return testConfig[keyName];
  }

  // Otherwise, get from browser storage
  return await getApiKeyFromStorage(keyName);
}

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
