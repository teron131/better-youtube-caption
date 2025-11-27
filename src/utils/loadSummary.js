(function () {
  const logDebug = (typeof BYC_LOGGER !== 'undefined' && BYC_LOGGER?.log) || (() => {});

  /**
   * Load existing summary for current video
   * Checks storage and displays summary if found
   */

  /**
   * Load and display summary for current video
   * @param {Object} elements - DOM elements
   */
  async function loadExistingSummary(elements) {
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
          logDebug('Popup: Found existing summary for video:', videoId);
          displaySummary(result[`summary_${videoId}`], elements.summaryContent);
        }
      });
    } catch (error) {
      logDebug('Popup: Error loading existing summary:', error);
    }
  }

  // Expose to global scope
  window.loadExistingSummary = loadExistingSummary;
})();
