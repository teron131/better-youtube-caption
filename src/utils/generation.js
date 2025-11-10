/**
 * Generation Actions
 * Handles summary and caption generation requests
 */

/**
 * Get current YouTube video tab
 * @returns {Promise<chrome.tabs.Tab>} Current tab or null
 */
async function getCurrentVideoTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (currentTab && currentTab.url && currentTab.url.includes('youtube.com/watch')) {
        resolve(currentTab);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Validate API keys and show error if missing
 * @param {Object} result - Storage result
 * @param {HTMLElement} statusElement - Status element to show errors
 * @param {Function} showSettingsView - Function to show settings view
 * @returns {boolean} True if valid
 */
function validateApiKeys(result, statusElement, showSettingsView) {
  const scrapeKey = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
  const openrouterKey = result[STORAGE_KEYS.OPENROUTER_API_KEY];

  if (!scrapeKey) {
    statusElement.textContent = 'Please enter Scrape Creators API key in Settings';
    statusElement.className = 'status error';
    showSettingsView();
    return false;
  }

  if (!openrouterKey) {
    statusElement.textContent = 'Please enter OpenRouter API key in Settings';
    statusElement.className = 'status error';
    showSettingsView();
    return false;
  }

  return true;
}

/**
 * Generate summary for current video
 * @param {Object} elements - DOM elements
 * @param {Function} showSettingsView - Function to show settings view
 */
async function generateSummary(elements, showSettingsView) {
  if (elements.generateSummaryBtn.disabled || elements.generateCaptionBtn.disabled) {
    return;
  }

  elements.status.textContent = '';
  elements.status.className = 'status';

  // Get settings
  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
      STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
      STORAGE_KEYS.TARGET_LANGUAGE,
    ],
    async (result) => {
      // Validate API keys
      if (!validateApiKeys(result, elements.status, showSettingsView)) {
        return;
      }

      const summarizerModel = getSummarizerModel(result);
      const targetLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE] || DEFAULTS.TARGET_LANGUAGE;

      // Show loading state
      elements.status.textContent = 'Generating summary...';
      elements.generateSummaryBtn.disabled = true;
      elements.generateCaptionBtn.disabled = true;
      elements.summaryContent.innerHTML = '<div class="summary-placeholder">Generating summary, please wait...</div>';

      // Get current tab
      const currentTab = await getCurrentVideoTab();
      if (!currentTab) {
        elements.status.textContent = 'Not a YouTube video page';
        elements.status.className = 'status error';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
        return;
      }

      const videoId = extractVideoId(currentTab.url);
      if (!videoId) {
        elements.status.textContent = 'Could not extract video ID';
        elements.status.className = 'status error';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
        return;
      }

      // Send message to content script
      chrome.tabs.sendMessage(
        currentTab.id,
        {
          action: MESSAGE_ACTIONS.GENERATE_SUMMARY,
          videoId: videoId,
          scrapeCreatorsApiKey: result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
          openRouterApiKey: result[STORAGE_KEYS.OPENROUTER_API_KEY],
          modelSelection: summarizerModel,
          targetLanguage: targetLanguage,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            elements.status.textContent = 'Error: ' + chrome.runtime.lastError.message;
            elements.status.className = 'status error';
            elements.generateSummaryBtn.disabled = false;
            elements.generateCaptionBtn.disabled = false;
            elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
          } else if (response && response.status === 'started') {
            elements.status.textContent = 'Processing video transcript...';
          } else if (response && response.status === 'error') {
            const errorMsg = response.message || 'Unknown error';
            elements.status.textContent = 'Error: ' + errorMsg;
            elements.status.className = 'status error';
            elements.generateSummaryBtn.disabled = false;
            elements.generateCaptionBtn.disabled = false;
            // Don't clear summary content if it's just a "already running" error
            if (!errorMsg.includes('already in progress')) {
              elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
            }
          }
        }
      );
    }
  );
}

/**
 * Generate captions for current video
 * @param {Object} elements - DOM elements
 * @param {Function} e - Event object
 */
async function generateCaptions(elements, showSettingsView) {
  if (elements.generateSummaryBtn.disabled || elements.generateCaptionBtn.disabled) {
    return;
  }

  elements.status.textContent = '';
  elements.status.className = 'status';

  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
    ],
    async (result) => {
      // Validate API keys
      if (!validateApiKeys(result, elements.status, showSettingsView)) {
        return;
      }

      const refinerModel = getRefinerModel(result);

      // Show loading state
      elements.status.textContent = 'Generating refined captions...';
      elements.generateCaptionBtn.disabled = true;
      elements.generateSummaryBtn.disabled = true;

      // Get current tab
      const currentTab = await getCurrentVideoTab();
      if (!currentTab) {
        elements.status.textContent = 'Not a YouTube video page';
        elements.status.className = 'status error';
        elements.generateCaptionBtn.disabled = false;
        elements.generateSummaryBtn.disabled = false;
        return;
      }

      const videoId = extractVideoId(currentTab.url);
      if (!videoId) {
        elements.status.textContent = 'Could not extract video ID';
        elements.status.className = 'status error';
        elements.generateCaptionBtn.disabled = false;
        elements.generateSummaryBtn.disabled = false;
        return;
      }

      // Send message to content script
      chrome.tabs.sendMessage(
        currentTab.id,
        {
          action: MESSAGE_ACTIONS.GENERATE_SUBTITLES,
          videoId: videoId,
          scrapeCreatorsApiKey: result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
          openRouterApiKey: result[STORAGE_KEYS.OPENROUTER_API_KEY],
          modelSelection: refinerModel,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            elements.status.textContent = 'Error: ' + chrome.runtime.lastError.message;
            elements.status.className = 'status error';
            elements.generateCaptionBtn.disabled = false;
            elements.generateSummaryBtn.disabled = false;
          } else if (response && response.status === 'started') {
            elements.status.textContent = 'Fetching and refining transcript...';
          } else if (response && response.status === 'error') {
            elements.status.textContent = 'Error: ' + (response.message || 'Unknown error');
            elements.status.className = 'status error';
            elements.generateCaptionBtn.disabled = false;
            elements.generateSummaryBtn.disabled = false;
          }
        }
      );
    }
  );
}

