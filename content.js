/**
 * Content Script for Better YouTube Caption Extension
 * Handles subtitle display, auto-generation, and communication with background script
 */

// Global state
let currentSubtitles = [];
let subtitleContainer = null;
let subtitleText = null;
let videoPlayer = null;
let videoContainer = null;
let checkInterval = null;
let initAttempts = 0;
let currentUrl = window.location.href;
let autoGenerationTriggered = new Set(); // Track which videos have had auto-generation triggered
let showSubtitlesEnabled = true; // Whether subtitles should be displayed

/**
 * Check if extension context is valid
 * @returns {boolean} True if context is valid
 */
function isExtensionContextValid() {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome.runtime &&
    typeof chrome.runtime.id === 'string' &&
    !!chrome.storage &&
    !!chrome.storage.local
  );
}

/**
 * Get refiner model selection from storage result
 * Priority: custom model > recommended model > default
 * @param {Object} result - Storage result object
 * @returns {string} Selected model
 */
function getRefinerModelSelection(result) {
  const customModel = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
  const recommendedModel = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]?.trim();
  return (
    (customModel && customModel.length > 0 ? customModel : null) ||
    (recommendedModel && recommendedModel.length > 0 ? recommendedModel : null) ||
    DEFAULTS.MODEL_REFINER
  );
}

/**
 * Check if auto-generation should be triggered and trigger it if conditions are met
 * @param {string} videoId - Video ID
 * @param {Object} storageResult - Storage result with API keys and settings
 * @param {boolean} checkCaptionsEnabled - Whether to check if captions are enabled
 * @param {boolean} withDelay - Whether to add a delay before triggering (for initial page load)
 */
function checkAndTriggerAutoGeneration(videoId, storageResult, checkCaptionsEnabled = true, withDelay = false) {
  // Check if auto-generation is enabled
  if (storageResult[STORAGE_KEYS.AUTO_GENERATE] !== true) {
    return false;
  }

  // Check if captions are enabled (if required)
  if (checkCaptionsEnabled && !showSubtitlesEnabled) {
    console.log('Content Script: Auto-generation enabled but captions are disabled, skipping auto-generation');
    return false;
  }

  // Check if API key is available
  if (!storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]) {
    return false;
  }

  // Check if already triggered for this video
  if (autoGenerationTriggered.has(videoId)) {
    return false;
  }

  // Mark as triggered
  autoGenerationTriggered.add(videoId);
  console.log('Content Script: Auto-generation enabled, ' + (withDelay ? 'waiting for page to load...' : 'triggering immediately...'));

  const trigger = () => {
    const executeTrigger = () => {
      // Double-check video ID hasn't changed
      const currentVideoId = extractVideoId(window.location.href);
      if (currentVideoId !== videoId) {
        console.log('Content Script: Video ID changed, cancelling auto-generation');
        autoGenerationTriggered.delete(videoId);
        return;
      }

      const modelSelection = getRefinerModelSelection(storageResult);
      triggerAutoGeneration(
        videoId,
        storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
        storageResult[STORAGE_KEYS.OPENROUTER_API_KEY],
        modelSelection
      );
    };

    // Double-check captions are still enabled if required
    if (checkCaptionsEnabled) {
      chrome.storage.local.get([STORAGE_KEYS.SHOW_SUBTITLES], (checkResult) => {
        const captionsStillEnabled = checkResult[STORAGE_KEYS.SHOW_SUBTITLES] !== false;
        
        if (!captionsStillEnabled) {
          console.log('Content Script: Captions disabled, cancelling auto-generation');
          autoGenerationTriggered.delete(videoId);
          return;
        }

        executeTrigger();
      });
    } else {
      // No caption check needed, trigger directly
      executeTrigger();
    }
  };

  if (withDelay) {
    setTimeout(() => {
      if (!isExtensionContextValid()) {
        console.debug('Content Script: Context invalidated before auto-generation.');
        autoGenerationTriggered.delete(videoId);
        return;
      }
      trigger();
    }, TIMING.AUTO_GENERATION_DELAY_MS);
  } else {
    trigger();
  }

  return true;
}

/**
 * Load stored subtitles for the current video from local storage
 * Also checks for auto-generation setting and triggers generation if enabled
 */
function loadStoredSubtitles() {
  try {
    if (!isExtensionContextValid()) {
      console.debug('Content Script: Extension context invalidated, skipping subtitle load.');
      return;
    }

    // Only proceed if we're on a YouTube video page
    if (!window.location.href.includes('youtube.com/watch')) {
      console.debug('Content Script: Not on a video page, skipping subtitle load.');
      return;
    }

    const videoId = extractVideoId(window.location.href);
    if (!videoId) {
      console.debug('Content Script: Could not extract video ID, skipping subtitle load.');
      return;
    }

    const keysToFetch = [
      videoId,
      STORAGE_KEYS.AUTO_GENERATE,
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
      STORAGE_KEYS.REFINER_CUSTOM_MODEL,
      STORAGE_KEYS.SHOW_SUBTITLES,
    ];

    chrome.storage.local.get(keysToFetch, (result) => {
      try {
        if (chrome.runtime.lastError) {
          if (
            chrome.runtime.lastError.message &&
            chrome.runtime.lastError.message.includes('Extension context invalidated')
          ) {
            console.debug('Content Script: Subtitle load aborted - extension context invalidated.');
            return;
          }
          console.error(
            'Content Script: Error loading subtitles from storage:',
            chrome.runtime.lastError.message
          );
          return;
        }

        // Update show subtitles setting
        showSubtitlesEnabled = result[STORAGE_KEYS.SHOW_SUBTITLES] !== false;

        if (result && result[videoId]) {
          console.log('Content Script: Found stored subtitles for this video.');
          currentSubtitles = result[videoId];
          if (showSubtitlesEnabled) {
            startSubtitleDisplay();
          }
        } else {
          console.log('Content Script: No stored subtitles found for this video.');
          // Try to trigger auto-generation if conditions are met
          checkAndTriggerAutoGeneration(videoId, result, true, true);
        }
      } catch (error) {
        console.error('Content Script: Error processing stored subtitles:', error);
      }
    });
  } catch (error) {
    if (error && error.message && error.message.includes('Extension context invalidated')) {
      console.debug('Content Script: Subtitle load aborted - extension context invalidated (outer).');
      return;
    }
    console.error('Content Script: Error in loadStoredSubtitles:', error);
  }
}

/**
 * Trigger automatic subtitle generation
 * @param {string} videoId - Video ID
 * @param {string} scrapeCreatorsApiKey - Scrape Creators API key
 * @param {string} openRouterApiKey - OpenRouter API key
 * @param {string} modelSelection - Model selection
 */
function triggerAutoGeneration(videoId, scrapeCreatorsApiKey, openRouterApiKey, modelSelection) {
  clearSubtitles();
  
  console.log('Content Script: Sending fetchSubtitles message to background...', {
    action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
    videoId: videoId,
    hasScrapeKey: !!scrapeCreatorsApiKey,
    hasOpenRouterKey: !!openRouterApiKey,
    modelSelection: modelSelection,
  });
  
  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
      videoId: videoId,
      scrapeCreatorsApiKey: scrapeCreatorsApiKey,
      openRouterApiKey: openRouterApiKey,
      modelSelection: modelSelection,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Content Script: Error triggering auto-generation:', chrome.runtime.lastError.message);
      } else {
        console.log('Content Script: Auto-generation triggered successfully, response:', response);
      }
    }
  );
}

/**
 * Monitor URL changes on YouTube (SPA behavior)
 */
function monitorUrlChanges() {
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      console.log('Better YouTube Caption: URL changed.');
      const oldVideoId = extractVideoId(currentUrl);
      currentUrl = window.location.href;
      const newVideoId = extractVideoId(currentUrl);
      
      // If video ID changed, clear the auto-generation tracking for the old video
      if (oldVideoId !== newVideoId) {
        autoGenerationTriggered.delete(oldVideoId);
      }
      
      onUrlChange();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Handle actions when the URL changes
 */
function onUrlChange() {
  console.log('Better YouTube Caption: Reinitializing for new video...');
  clearSubtitles();
  initAttempts = 0;
  initialize();
}

/**
 * Find video elements on the YouTube page
 * @returns {boolean} True if video elements found
 */
function findVideoElements() {
  videoPlayer = document.querySelector(YOUTUBE.SELECTORS.VIDEO_PLAYER);
  if (!videoPlayer) return false;

  // Try finding a standard container, fallback to player's parent
  videoContainer =
    document.querySelector(YOUTUBE.SELECTORS.MOVIE_PLAYER) ||
    document.querySelector(YOUTUBE.SELECTORS.VIDEO_CONTAINER) ||
    videoPlayer.parentElement;

  return !!videoContainer;
}

/**
 * Initialize the content script
 */
function initialize() {
  console.log('Better YouTube Caption: Initializing content script...');

  // Only initialize on YouTube video pages
  if (!window.location.href.includes('youtube.com/watch')) {
    console.debug('Content Script: Not on a video page, skipping initialization.');
    return;
  }

  if (!findVideoElements()) {
    initAttempts++;
    if (initAttempts < TIMING.MAX_INIT_ATTEMPTS) {
      console.log(
        `Video player not found, retrying (${initAttempts}/${TIMING.MAX_INIT_ATTEMPTS})...`
      );
      setTimeout(initialize, TIMING.INIT_RETRY_DELAY_MS);
    } else {
      console.error(
        'Better YouTube Caption: Video player or container not found after multiple attempts.'
      );
    }
    return;
  }

  console.log('Better YouTube Caption: Video player found.', videoPlayer);
  console.log('Better YouTube Caption: Video container found.', videoContainer);

  createSubtitleElements();
  loadStoredSubtitles();
  loadCaptionFontSize();
  setupMessageListener();
}

/**
 * Setup message listener for content script
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.GET_VIDEO_TITLE) {
      const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
      const title = titleElement ? titleElement.textContent : null;
      sendResponse({ title: title });
      return true;
    } else if (message.action === MESSAGE_ACTIONS.GENERATE_SUMMARY) {
      handleGenerateSummary(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.GENERATE_SUBTITLES) {
      handleGenerateSubtitles(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.SUBTITLES_GENERATED) {
      handleSubtitlesGenerated(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.TOGGLE_SUBTITLES) {
      handleToggleSubtitles(message, sendResponse);
      return true;
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_CAPTION_FONT_SIZE) {
      handleUpdateCaptionFontSize(message, sendResponse);
      return true;
    }
  });
}

/**
 * Handle generate summary request
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleGenerateSummary(message, sendResponse) {
  console.log('Content Script: Received generateSummary request');
  
  const videoId = message.videoId || extractVideoId(window.location.href);

  if (!videoId) {
    sendResponse({
      status: 'error',
      message: 'Could not extract video ID from URL.',
    });
    return;
  }

  console.log('Content Script: Requesting summary from background for video:', videoId);

  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.GENERATE_SUMMARY,
      videoId: videoId,
      scrapeCreatorsApiKey: message.scrapeCreatorsApiKey,
      openRouterApiKey: message.openRouterApiKey,
      modelSelection: message.modelSelection,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message to background:', chrome.runtime.lastError);
        sendResponse({
          status: 'error',
          message: 'Could not communicate with background script.',
        });
      } else {
        console.log('Content Script: Summary request sent to background, response:', response);
      }
    }
  );

  sendResponse({ status: 'started' });
}

/**
 * Handle generate subtitles request
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleGenerateSubtitles(message, sendResponse) {
  console.log('Content Script: Received generateSubtitles request');
  
  const videoId = message.videoId || extractVideoId(window.location.href);

  if (!videoId) {
    sendResponse({
      status: 'error',
      message: 'Could not extract video ID from URL.',
    });
    return;
  }

  console.log('Content Script: Sending video ID to background:', videoId);

  clearSubtitles();

  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.FETCH_SUBTITLES,
      videoId: videoId,
      scrapeCreatorsApiKey: message.scrapeCreatorsApiKey,
      openRouterApiKey: message.openRouterApiKey,
      modelSelection: message.modelSelection,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message to background:', chrome.runtime.lastError);
        sendResponse({
          status: 'error',
          message: 'Could not communicate with background script.',
        });
      } else {
        console.log('Content Script: Message sent to background, response:', response);
      }
    }
  );

  sendResponse({ status: 'started' });
}

/**
 * Handle subtitles generated message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleSubtitlesGenerated(message, sendResponse) {
  console.log('Content Script: Received subtitlesGenerated request');
  currentSubtitles = message.subtitles || [];
  console.log(`Received ${currentSubtitles.length} subtitle entries.`);

  if (currentSubtitles.length > 0) {
    if (showSubtitlesEnabled) {
      startSubtitleDisplay();
    }

    // Store the subtitles locally
    const videoId = message.videoId || extractVideoId(window.location.href);
    
    if (videoId) {
      chrome.storage.local.set({ [videoId]: currentSubtitles }, () => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('QUOTA')) {
            console.warn('Storage quota exceeded. Transcript will not be saved, but subtitles will still display.');
          } else {
            console.error('Error saving subtitles:', chrome.runtime.lastError.message);
          }
        } else {
          console.log('Content Script: Subtitles saved to local storage for video ID:', videoId);
        }
      });
    } else {
      console.warn('Content Script: Could not extract video ID, subtitles not saved.');
    }

    sendResponse({ status: 'success' });
  } else {
    console.warn('Received empty subtitles array.');
    clearSubtitles();
    sendResponse({ status: 'no_subtitles_found' });
  }
}

/**
 * Load and apply caption font size from storage
 */
function loadCaptionFontSize() {
  chrome.storage.local.get([STORAGE_KEYS.CAPTION_FONT_SIZE], (result) => {
    const fontSize = result[STORAGE_KEYS.CAPTION_FONT_SIZE] || DEFAULTS.CAPTION_FONT_SIZE;
    applyCaptionFontSize(fontSize);
  });
}

/**
 * Apply caption font size
 * @param {string} size - Size key (S, M, L)
 */
function applyCaptionFontSize(size) {
  const sizeConfig = FONT_SIZES.CAPTION[size] || FONT_SIZES.CAPTION.M;
  const subtitleText = document.getElementById(ELEMENT_IDS.SUBTITLE_TEXT);
  
  if (subtitleText) {
    // Use clamp() to set min/max bounds
    subtitleText.style.fontSize = `clamp(${sizeConfig.min}, ${sizeConfig.base}, ${sizeConfig.max})`;
  }
  
  // Set CSS custom properties for fullscreen styles
  document.documentElement.style.setProperty('--caption-font-size-base', sizeConfig.base);
  document.documentElement.style.setProperty('--caption-font-size-max', sizeConfig.max);
  document.documentElement.style.setProperty('--caption-font-size-min', sizeConfig.min);
  document.documentElement.style.setProperty('--caption-font-size-fullscreen', sizeConfig.fullscreen);
  document.documentElement.style.setProperty('--caption-font-size-fullscreen-max', sizeConfig.fullscreenMax);
}

/**
 * Handle update caption font size message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleUpdateCaptionFontSize(message, sendResponse) {
  const fontSize = message.fontSize || DEFAULTS.CAPTION_FONT_SIZE;
  applyCaptionFontSize(fontSize);
  sendResponse({ status: 'success' });
}

/**
 * Handle toggle subtitles message
 * @param {Object} message - Message object
 * @param {Function} sendResponse - Response callback
 */
function handleToggleSubtitles(message, sendResponse) {
  console.log('Content Script: Received toggleSubtitles request');
  const hasShowSubtitles = Object.prototype.hasOwnProperty.call(message, 'showSubtitles');
  const hasEnabled = Object.prototype.hasOwnProperty.call(message, 'enabled');
  const nextState = hasShowSubtitles
    ? message.showSubtitles !== false
    : hasEnabled
    ? message.enabled !== false
    : true;
  const wasEnabled = showSubtitlesEnabled;
  showSubtitlesEnabled = nextState;
  chrome.storage.local.set({ [STORAGE_KEYS.SHOW_SUBTITLES]: showSubtitlesEnabled });

  if (showSubtitlesEnabled && currentSubtitles.length > 0) {
    startSubtitleDisplay();
  } else {
    stopSubtitleDisplay();
    hideCurrentSubtitle();
  }

  // If captions were just turned on and there are no subtitles, check for auto-generation
  if (showSubtitlesEnabled && !wasEnabled && currentSubtitles.length === 0) {
    const videoId = extractVideoId(window.location.href);
    if (videoId) {
      chrome.storage.local.get(
        [
          videoId,
          STORAGE_KEYS.AUTO_GENERATE,
          STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
          STORAGE_KEYS.OPENROUTER_API_KEY,
          STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
          STORAGE_KEYS.REFINER_CUSTOM_MODEL,
        ],
        (result) => {
          // Check if subtitles already exist for this video
          if (result[videoId] && result[videoId].length > 0) {
            console.log('Content Script: Subtitles already exist for this video, loading them...');
            currentSubtitles = result[videoId];
            startSubtitleDisplay();
            return;
          }

          // Try to trigger auto-generation (no delay, captions already enabled)
          checkAndTriggerAutoGeneration(videoId, result, false, false);
        }
      );
    }
  }

  sendResponse({ status: 'success' });
}

/**
 * Create subtitle elements and append them to the video container
 */
function createSubtitleElements() {
  if (document.getElementById(ELEMENT_IDS.SUBTITLE_CONTAINER)) return;

  subtitleContainer = document.createElement('div');
  subtitleContainer.id = ELEMENT_IDS.SUBTITLE_CONTAINER;
  subtitleContainer.style.position = 'absolute';
  subtitleContainer.style.zIndex = '9999';
  subtitleContainer.style.pointerEvents = 'none';
  subtitleContainer.style.display = 'none';

  subtitleText = document.createElement('div');
  subtitleText.id = ELEMENT_IDS.SUBTITLE_TEXT;
  subtitleContainer.appendChild(subtitleText);

  if (videoContainer) {
    if (getComputedStyle(videoContainer).position === 'static') {
      videoContainer.style.position = 'relative';
    }
    videoContainer.appendChild(subtitleContainer);
    console.log('Subtitle container added to video container.');
  } else {
    console.error('Cannot add subtitle container, video container not found.');
  }
}

/**
 * Start displaying subtitles
 */
function startSubtitleDisplay() {
  if (!videoPlayer || !subtitleContainer) {
    console.warn('Cannot start subtitle display: Player or container missing.');
    return;
  }

  stopSubtitleDisplay();

  console.log('Starting subtitle display interval.');
  checkInterval = setInterval(updateSubtitles, TIMING.SUBTITLE_UPDATE_INTERVAL_MS);

  videoPlayer.addEventListener('play', updateSubtitles);
  videoPlayer.addEventListener('seeked', updateSubtitles);
}

/**
 * Stop displaying subtitles
 */
function stopSubtitleDisplay() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log('Stopped subtitle display interval.');
  }
  if (videoPlayer) {
    videoPlayer.removeEventListener('play', updateSubtitles);
    videoPlayer.removeEventListener('seeked', updateSubtitles);
  }
}

/**
 * Clear subtitles and stop display
 */
function clearSubtitles() {
  currentSubtitles = [];
  stopSubtitleDisplay();
  hideCurrentSubtitle();
  console.log('Subtitles cleared.');
}

/**
 * Hide the current subtitle
 */
function hideCurrentSubtitle() {
  if (subtitleContainer) {
    subtitleContainer.style.display = 'none';
  }
  if (subtitleText) {
    subtitleText.textContent = '';
  }
}

/**
 * Update subtitles based on the current video time
 */
function updateSubtitles() {
  if (!videoPlayer || !subtitleText || !subtitleContainer) {
    return;
  }

  if (isNaN(videoPlayer.currentTime)) return;

  const currentTime = videoPlayer.currentTime * 1000; // Convert to ms
  let foundSubtitle = null;

  for (const subtitle of currentSubtitles) {
    if (currentTime >= subtitle.startTime && currentTime <= subtitle.endTime) {
      foundSubtitle = subtitle;
      break;
    }
  }

  if (foundSubtitle) {
    if (subtitleText.textContent !== foundSubtitle.text) {
      subtitleText.textContent = foundSubtitle.text;
    }
    subtitleContainer.style.display = 'block';
  } else {
    hideCurrentSubtitle();
  }
}

// Initialize immediately since we're using document_end in manifest
(function() {
  console.log('Better YouTube Caption: Content script loaded, readyState:', document.readyState);
  
  const startInitialization = () => {
    initialize();
    monitorUrlChanges();
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startInitialization);
  } else {
    // Give YouTube a moment to render if we're already loaded
    setTimeout(startInitialization, 500);
  }
})();
