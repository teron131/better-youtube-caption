/**
 * Background Script Message Handlers
 * Handles messages from content and popup scripts
 */

/**
 * Send status update to popup
 * @param {number|null} tabId - Tab ID
 * @param {string} text - Status text
 * @param {boolean} success - Success flag
 * @param {boolean} error - Error flag
 */
function sendStatusUpdate(tabId, text, success = false, error = false) {
  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
      text: text,
      success: success,
      error: error,
      tabId: tabId,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Popup might be closed, ignore
      }
    }
  );
}

/**
 * Send error to popup
 * @param {number|null} tabId - Tab ID
 * @param {string} errorMessage - Error message
 */
function sendError(tabId, errorMessage) {
  chrome.runtime.sendMessage(
    {
      action: MESSAGE_ACTIONS.SHOW_ERROR,
      error: errorMessage,
      tabId: tabId,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Popup might be closed, ignore
      }
    }
  );
}

/**
 * Extract and format error message
 * @param {Error} error - Error object
 * @returns {string} Formatted error message
 */
function extractErrorMessage(error) {
  let errorMessage = error.message || 'Unknown error';
  if (error.message && error.message.includes('is not a valid model ID')) {
    const match = error.message.match(/OpenRouter API error: (.+)/);
    errorMessage = match ? match[1] : error.message;
  }
  return errorMessage;
}

/**
 * Get model selection with fallback priority
 * @param {string} messageModelSelection - Model from message
 * @param {string} customModel - Custom model from storage
 * @param {string} recommendedModel - Recommended model from storage
 * @param {string} defaultModel - Default model
 * @returns {string} Selected model
 */
function getModelSelection(messageModelSelection, customModel, recommendedModel, defaultModel) {
  return (
    messageModelSelection ||
    (customModel?.trim() ? customModel.trim() : '') ||
    (recommendedModel ? recommendedModel.trim() : '') ||
    defaultModel
  );
}

/**
 * Handle generate summary request
 * @param {Object} message - Message object
 * @param {number|null} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
async function handleGenerateSummary(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
  } = message;

  console.log('Background Script: Received generateSummary request for Video ID:', videoId);

  if (!videoId) {
    sendResponse({ status: 'error', message: 'Video ID is required.' });
    return;
  }

  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;

  // Check if summary is already cached
  chrome.storage.local.get([`summary_${videoId}`], async (result) => {
    if (result[`summary_${videoId}`]) {
      console.log('Summary found in cache');
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: 'SUMMARY_GENERATED',
          summary: result[`summary_${videoId}`],
          videoId: videoId,
        });
      }
      // Also send to popup via runtime message
      chrome.runtime.sendMessage({
        action: 'SUMMARY_GENERATED',
        summary: result[`summary_${videoId}`],
        videoId: videoId,
        tabId: tabId || null,
      });
      sendResponse({ status: 'completed', cached: true });
      return;
    }

    try {
      sendStatusUpdate(tabId, 'Fetching YouTube transcript...');

      // Get API keys
      const scrapeCreatorsKey = messageScrapeCreatorsKey || (await getApiKeyWithFallback('scrapeCreatorsApiKey'));
      if (!scrapeCreatorsKey) {
        throw new Error('Scrape Creators API key not found');
      }

      const openRouterKey = messageOpenRouterKey || (await getApiKeyWithFallback('openRouterApiKey'));
      if (!openRouterKey) {
        throw new Error('OpenRouter API key not found');
      }

      // Get model selection - use summarizer defaults for summary generation
      const customModel = await getApiKeyFromStorage(STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL);
      const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL);
      const modelSelection = getModelSelection(
        messageModelSelection,
        customModel,
        recommendedModel,
        DEFAULTS.MODEL_SUMMARIZER
      );
      console.log('Background (summary): using model', modelSelection);

      // Fetch transcript
      const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
      console.log(`Fetched ${transcriptData.segments.length} transcript segments for summary`);

      sendStatusUpdate(tabId, 'Generating summary with AI...');

      // Generate summary using workflow
      const transcriptText = transcriptData.segments.map(seg => seg.text).join(' ');
      
      const progressCallback = (message) => {
        console.log('Summary workflow:', message);
        sendStatusUpdate(tabId, message);
      };

      // Execute summarization workflow
      const workflowResult = await executeSummarizationWorkflow(
        {
          transcript: transcriptText,
          analysis_model: modelSelection,
          quality_model: modelSelection,
        },
        openRouterKey,
        progressCallback
      );

      const summary = workflowResult.summary_text;
      
      console.log(
        `Summary workflow completed: ${workflowResult.iteration_count} iterations, ` +
        `quality score: ${workflowResult.quality_score}%`
      );

      // Save summary to storage
      chrome.storage.local.set({ [`summary_${videoId}`]: summary });

      // Send summary to content script/popup
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: 'SUMMARY_GENERATED',
          summary: summary,
          videoId: videoId,
        });
      }
      chrome.runtime.sendMessage({
        action: 'SUMMARY_GENERATED',
        summary: summary,
        videoId: videoId,
        tabId: tabId || null,
      });

      sendStatusUpdate(tabId, 'Summary generated successfully!', true);
      sendResponse({ status: 'completed' });
    } catch (error) {
      console.error('Error generating summary:', error);
      
      const errorMessage = extractErrorMessage(error);
      
      if (tabId) {
        sendError(tabId, errorMessage);
        sendStatusUpdate(tabId, `Error: ${errorMessage}`, false, true);
      }
      sendResponse({ status: 'error', message: errorMessage });
    }
  });
}

/**
 * Handle fetch subtitles request
 * @param {Object} message - Message object
 * @param {number|null} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
async function handleFetchSubtitles(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
  } = message;

  console.log('Background Script: Received fetchSubtitles request for Video ID:', videoId);

  if (!videoId) {
    sendResponse({ status: 'error', message: 'Video ID is required.' });
    return;
  }

  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;
  console.log('Background Script: Using URL for API:', urlForApi);

  // Send immediate acknowledgment
  sendResponse({ status: 'processing', message: 'Request received, processing...' });

  // Check if subtitles are cached
  getStoredSubtitles(videoId)
    .then((cachedSubtitles) => {
      if (cachedSubtitles) {
        console.log('Subtitles found in local storage for this video.');
        if (tabId) {
          chrome.tabs.sendMessage(
            tabId,
            {
              action: MESSAGE_ACTIONS.SUBTITLES_GENERATED,
              subtitles: cachedSubtitles,
              videoId: videoId,
            },
            () => {
              if (chrome.runtime.lastError) {
                console.log(
                  'Could not send message to tab (tab may be closed):',
                  chrome.runtime.lastError.message
                );
              }
            }
          );
        }
      } else {
        processNewSubtitles(urlForApi, videoId, messageScrapeCreatorsKey, messageOpenRouterKey, messageModelSelection, tabId);
      }
    })
    .catch((error) => {
      console.error('Error checking storage:', error);
    });
}

/**
 * Process new subtitles (fetch and refine)
 * @param {string} urlForApi - YouTube URL
 * @param {string} videoId - Video ID
 * @param {string} messageScrapeCreatorsKey - Scrape Creators API key from message
 * @param {string} messageOpenRouterKey - OpenRouter API key from message
 * @param {string} messageModelSelection - Model selection from message
 * @param {number|null} tabId - Tab ID
 */
async function processNewSubtitles(
  urlForApi,
  videoId,
  messageScrapeCreatorsKey,
  messageOpenRouterKey,
  messageModelSelection,
  tabId
) {
  console.log('No cached subtitles found. Fetching transcript...');

  sendStatusUpdate(tabId, 'Fetching YouTube transcript...');

  try {
    // Get Scrape Creators API key
    const scrapeCreatorsKey = messageScrapeCreatorsKey || (await getApiKeyWithFallback('scrapeCreatorsApiKey'));
    if (!scrapeCreatorsKey) {
      throw new Error('Scrape Creators API key not found. Please set it in config.js or popup.');
    }

    // Fetch transcript
    const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
    console.log(`Fetched ${transcriptData.segments.length} transcript segments`);
    console.log(`Video title: ${transcriptData.title}`);
    
    // Enhance segments with startTimeText
    const enhancedSegments = transcriptData.segments.map((seg) => {
      const startTimeText = seg.startTimeText || formatTimestamp(seg.startTime);
      return {
        ...seg,
        startTimeText: startTimeText,
      };
    });
    
    // Get OpenRouter API key and model selection
    const openRouterKey =
      messageOpenRouterKey ||
      (await getApiKeyFromStorage(STORAGE_KEYS.OPENROUTER_API_KEY)) ||
      (await getApiKeyWithFallback('openRouterApiKey'));
    
    // Get model selection - use refiner defaults for subtitle refinement
    const customModel = await getApiKeyFromStorage(STORAGE_KEYS.REFINER_CUSTOM_MODEL);
    const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.REFINER_RECOMMENDED_MODEL);
    const modelSelection = getModelSelection(
      messageModelSelection,
      customModel,
      recommendedModel,
      DEFAULTS.MODEL_REFINER
    );
    
    console.log('Background (transcript): using model', modelSelection);
    
    let subtitles = enhancedSegments;
    
    // Refine transcript if OpenRouter key is available
    if (openRouterKey && openRouterKey.trim().length > 0) {
      sendStatusUpdate(tabId, 'Refining transcript with AI...');
      
      try {
        const progressCallback = (message) => {
          console.log('Background (transcript): Progress -', message);
          sendStatusUpdate(tabId, message);
        };
        
        console.log('Background (transcript): Starting refinement with', enhancedSegments.length, 'segments');
        subtitles = await refineTranscriptSegments(
          enhancedSegments,
          transcriptData.title,
          transcriptData.description,
          openRouterKey,
          progressCallback,
          modelSelection
        );
        
        console.log(`Background (transcript): Refinement complete - ${subtitles.length} segments`);
      } catch (refinementError) {
        console.warn('Transcript refinement failed, using original:', refinementError);
        
        const errorMessage = extractErrorMessage(refinementError);
        sendError(tabId, errorMessage);
        sendStatusUpdate(tabId, 'Using original transcript (refinement failed)');
        // Fallback to original segments
        subtitles = enhancedSegments;
      }
    } else {
      console.log('OpenRouter API key not found, skipping refinement');
    }

    // Send subtitles to content script
    if (tabId) {
      chrome.tabs.sendMessage(
        tabId,
        {
          action: MESSAGE_ACTIONS.SUBTITLES_GENERATED,
          subtitles: subtitles,
          videoId: videoId,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.log(
              'Could not send message to tab (tab may be closed):',
              chrome.runtime.lastError.message
            );
          }
        }
      );
      sendStatusUpdate(tabId, 'Transcript fetched and ready!', true);
    }

    // Save subtitles
    try {
      await ensureStorageSpace();
    } catch (storageError) {
      console.warn('Storage management failed:', storageError);
    }
    
    await saveSubtitles(videoId, subtitles);
    console.log('Background: Subtitle fetch completed successfully');
  } catch (error) {
    console.error('Error fetching/parsing subtitles:', error);
    const errorMessage = `Error: ${error.message || 'Unknown error fetching subtitles.'}`;
    sendStatusUpdate(tabId, errorMessage, false, true);
  }
}

