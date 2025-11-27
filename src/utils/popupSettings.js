/**
 * Popup Settings Management
 * Handles loading and saving settings in the popup UI
 */

/**
 * Save a setting to storage
 * @param {string} key - Storage key
 * @param {*} value - Value to save
 */
(function () {
  const logDebug = (typeof BYC_LOGGER !== 'undefined' && BYC_LOGGER?.log) || (() => {});

function saveSetting(key, value) {
  const settings = { [key]: value };
  chrome.storage.local.set(settings, () => {
    logDebug('Auto-saved:', key, value);
  });
}

/**
 * Load all settings and populate UI
 * @param {Object} elements - DOM elements for settings inputs
 */
function loadSettings(elements) {
  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
      STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
      STORAGE_KEYS.AUTO_GENERATE,
      STORAGE_KEYS.SHOW_SUBTITLES,
      STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED,
      STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM,
    ],
    (result) => {
      // API Keys
      if (result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY] && elements.scrapeApiKey) {
        elements.scrapeApiKey.value = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
      }
      if (result[STORAGE_KEYS.OPENROUTER_API_KEY] && elements.openrouterApiKey) {
        elements.openrouterApiKey.value = result[STORAGE_KEYS.OPENROUTER_API_KEY];
      }

      // Toggles
      if (elements.autoGenerateToggle) {
        elements.autoGenerateToggle.checked = result[STORAGE_KEYS.AUTO_GENERATE] === true;
      }
      
      const showSubtitlesValue = result[STORAGE_KEYS.SHOW_SUBTITLES] !== undefined
        ? result[STORAGE_KEYS.SHOW_SUBTITLES]
        : DEFAULTS.SHOW_SUBTITLES;
      if (elements.showSubtitlesToggle) {
        elements.showSubtitlesToggle.checked = showSubtitlesValue === true;
      }

      // Update comboboxes (custom takes priority over recommended)
      // Summarizer
      const summarizerCustom = result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]?.trim();
      const summarizerRecommended = result[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL] || DEFAULTS.MODEL_SUMMARIZER;
      const summarizerValue = summarizerCustom || summarizerRecommended;
      setComboboxValue('summarizer', summarizerValue);

      // Refiner
      const refinerCustom = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
      const refinerRecommended = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL] || DEFAULTS.MODEL_REFINER;
      const refinerValue = refinerCustom || refinerRecommended;
      setComboboxValue('refiner', refinerValue);
      
      // Target Language
      const customLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM]?.trim();
      const recommendedLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED] || DEFAULTS.TARGET_LANGUAGE_RECOMMENDED;
      const targetLanguageValue = customLanguage || recommendedLanguage;
      setComboboxValue('targetLanguage', targetLanguageValue);
    }
  );
}

/**
 * Setup settings event listeners
 * @param {Object} elements - DOM elements for settings inputs
 */
function setupSettingsListeners(elements) {
  // API Keys
  if (elements.scrapeApiKey) {
    elements.scrapeApiKey.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.SCRAPE_CREATORS_API_KEY, this.value.trim());
    });
  }

  if (elements.openrouterApiKey) {
    elements.openrouterApiKey.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.OPENROUTER_API_KEY, this.value.trim());
    });
  }

  // Model comboboxes are handled by combobox.js

  // Toggles
  if (elements.autoGenerateToggle) {
    elements.autoGenerateToggle.addEventListener('change', function() {
      saveSetting(STORAGE_KEYS.AUTO_GENERATE, this.checked);
    });
  }

  // Show subtitles toggle (special handling for content script communication)
  if (elements.showSubtitlesToggle) {
    elements.showSubtitlesToggle.addEventListener('change', function() {
      const enabled = this.checked;
      saveSetting(STORAGE_KEYS.SHOW_SUBTITLES, enabled);
      
      // Send message to content script to toggle subtitles
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab && currentTab.url && currentTab.url.includes('youtube.com/watch')) {
          chrome.tabs.sendMessage(
            currentTab.id,
            {
              action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
              showSubtitles: enabled,
              enabled: enabled,
            },
            () => {
              if (chrome.runtime.lastError) {
                logDebug('Popup: Unable to toggle subtitles:', chrome.runtime.lastError.message);
              }
            }
          );
        }
      });
    });
  }

  // Target Language is handled by combobox.js
}

/**
 * Get current model selection for summarizer
 * @param {Object} result - Storage result object
 * @returns {string} Selected model
 */
function getSummarizerModel(result) {
  const customModel = result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]?.trim();
  const recommendedModel = result[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL]?.trim();
  return customModel || recommendedModel || DEFAULTS.MODEL_SUMMARIZER;
}

/**
 * Get current model selection for refiner
 * @param {Object} result - Storage result object
 * @returns {string} Selected model
 */
function getRefinerModel(result) {
  const customModel = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
  const recommendedModel = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]?.trim();
  return customModel || recommendedModel || DEFAULTS.MODEL_REFINER;
}

/**
 * Get current target language selection
 * @param {Object} result - Storage result object
 * @returns {string} Selected target language
 */
function getTargetLanguage(result) {
  const customLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM]?.trim();
  const recommendedLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED]?.trim();
  return customLanguage || recommendedLanguage || DEFAULTS.TARGET_LANGUAGE_RECOMMENDED;
}

  // Expose globally
  window.saveSetting = saveSetting;
  window.loadSettings = loadSettings;
  window.setupSettingsListeners = setupSettingsListeners;
  window.getSummarizerModel = getSummarizerModel;
  window.getRefinerModel = getRefinerModel;
  window.getTargetLanguage = getTargetLanguage;
})();
const logDebug = (typeof BYC_LOGGER !== 'undefined' && BYC_LOGGER?.log) || (() => {});
