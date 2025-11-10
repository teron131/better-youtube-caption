/**
 * Popup Settings Management
 * Handles loading and saving settings in the popup UI
 */

/**
 * Save a setting to storage
 * @param {string} key - Storage key
 * @param {*} value - Value to save
 */
function saveSetting(key, value) {
  const settings = { [key]: value };
  chrome.storage.local.set(settings, () => {
    console.debug('Auto-saved:', key, value);
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
      STORAGE_KEYS.TARGET_LANGUAGE,
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

      // Summarizer models
      const summarizerRec = result[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL];
      if (elements.summarizerRecommendedModel) {
        elements.summarizerRecommendedModel.value = summarizerRec || DEFAULTS.MODEL_SUMMARIZER;
      }
      if (result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] && elements.summarizerCustomModel) {
        const trimmed = result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL].trim();
        elements.summarizerCustomModel.value = trimmed || '';
      }

      // Refiner models
      const refinerRec = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL];
      if (elements.refinerRecommendedModel) {
        elements.refinerRecommendedModel.value = refinerRec || DEFAULTS.MODEL_REFINER;
      }
      if (result[STORAGE_KEYS.REFINER_CUSTOM_MODEL] && elements.refinerCustomModel) {
        const trimmed = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL].trim();
        elements.refinerCustomModel.value = trimmed || '';
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

      // Target Language
      const targetLanguageValue = result[STORAGE_KEYS.TARGET_LANGUAGE] || DEFAULTS.TARGET_LANGUAGE;
      if (elements.targetLanguage) {
        elements.targetLanguage.value = targetLanguageValue;
      }
      if (result[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM] && elements.targetLanguageCustom) {
        const trimmed = result[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM].trim();
        elements.targetLanguageCustom.value = trimmed || '';
      }

      // Update select dropdowns
      const summarizerValue = summarizerRec || DEFAULTS.MODEL_SUMMARIZER;
      setSelectValue('summarizer', summarizerValue);

      const refinerValue = refinerRec || DEFAULTS.MODEL_REFINER;
      setSelectValue('refiner', refinerValue);
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

  // Custom models
  if (elements.summarizerCustomModel) {
    elements.summarizerCustomModel.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL, this.value.trim());
    });
  }

  if (elements.refinerCustomModel) {
    elements.refinerCustomModel.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.REFINER_CUSTOM_MODEL, this.value.trim());
    });
  }

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
                console.debug(
                  'Popup: Unable to toggle subtitles:',
                  chrome.runtime.lastError.message
                );
              }
            }
          );
        }
      });
    });
  }

  // Target Language
  if (elements.targetLanguage) {
    elements.targetLanguage.addEventListener('change', function() {
      saveSetting(STORAGE_KEYS.TARGET_LANGUAGE, this.value);
    });
  }

  if (elements.targetLanguageCustom) {
    elements.targetLanguageCustom.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM, this.value.trim());
    });
  }
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
  const recommendedLanguage = result[STORAGE_KEYS.TARGET_LANGUAGE]?.trim();
  return customLanguage || recommendedLanguage || DEFAULTS.TARGET_LANGUAGE;
}
