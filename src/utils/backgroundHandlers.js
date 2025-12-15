/**
 * Background Script Message Handlers
 * Handles messages from content and sidepanel scripts
 */

import { executeSummarizationWorkflow } from "../captionSummarizer.js";
import { getConfig } from "../config.js";
import { DEFAULTS, MESSAGE_ACTIONS, STORAGE_KEYS } from "../constants.js";
import { ensureStorageSpace, getApiKeyFromStorage, getStoredSubtitles, saveSubtitles } from "../storage.js";
import { fetchYouTubeTranscript, formatTimestamp, refineTranscriptSegments } from "../transcript.js";
import { convertS2T, convertSegmentsS2T } from "./opencc.js";

// Track running summary generations to prevent concurrent runs
const runningSummaryGenerations = new Set();

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
 * Send status update to sidepanel
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
        // Sidepanel might be closed, ignore
      }
    }
  );
}

/**
 * Send error to sidepanel
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
        // Sidepanel might be closed, ignore
      }
    }
  );
}

/**
 * Extract and format error message
 * @param {Error|Object} error - Error object
 * @returns {string} Formatted error message
 */
function extractErrorMessage(error) {
  if (error instanceof Error) {
    const msg = error.message || 'Unknown error';
    // Extract cleaner message for OpenRouter API errors
    const match = msg.match(/OpenRouter API error: (.+)/);
    return match ? match[1] : msg;
  }
  
  if (typeof error === 'object' && error !== null) {
    if (error.message) return String(error.message);
    return JSON.stringify(error);
  }
  
  return String(error);
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
export async function handleGenerateSummary(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
    targetLanguage: messageTargetLanguage,
  } = message;

  console.log('Background Script: Received generateSummary request for Video ID:', videoId);

  if (!videoId) {
    sendResponse({ status: 'error', message: 'Video ID is required.' });
    return;
  }

  const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;

  // Check if summary generation is already running for this video
  if (runningSummaryGenerations.has(videoId)) {
    sendResponse({ status: 'error', message: 'Summary generation is already in progress for this video.' });
    return;
  }

  // Mark as running
  runningSummaryGenerations.add(videoId);

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

      // Get target language (custom if provided, otherwise recommended)
      const customLanguage = await getApiKeyFromStorage(STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM);
      const recommendedLanguage = await getApiKeyFromStorage(STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED);
      const storedTargetLanguage = (customLanguage?.trim() || recommendedLanguage || DEFAULTS.TARGET_LANGUAGE_RECOMMENDED);
      const targetLanguage = messageTargetLanguage || storedTargetLanguage;

    // Fetch transcript
    const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
    
    // Skip if no transcript available
    if (!transcriptData || !transcriptData.segments || transcriptData.segments.length === 0) {
      console.log('No transcript available, skipping summary generation');
      sendStatusUpdate(tabId, 'No transcript available for this video', false, true);
      runningSummaryGenerations.delete(videoId);
      return;
    }
    
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
        target_language: targetLanguage,
      },
      openRouterKey,
      progressCallback
    );

    let summary = workflowResult.summary_text;
    
    console.log(
      `Summary workflow completed: ${workflowResult.iteration_count} iterations, ` +
      `quality score: ${workflowResult.quality_score}%`
    );

    // Convert Simplified Chinese to Traditional Chinese using OpenCC
    summary = convertS2T(summary);

    // Save summary to storage
    chrome.storage.local.set({ [`summary_${videoId}`]: summary });

    // Send summary to content script/sidepanel
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
  } finally {
    // Always remove from running set when done
    runningSummaryGenerations.delete(videoId);
  }
}

/**
 * Handle fetch subtitles request
 * @param {Object} message - Message object
 * @param {number|null} tabId - Tab ID
 * @param {Function} sendResponse - Response callback
 */
export async function handleFetchSubtitles(message, tabId, sendResponse) {
  const {
    videoId,
    scrapeCreatorsApiKey: messageScrapeCreatorsKey,
    openRouterApiKey: messageOpenRouterKey,
    modelSelection: messageModelSelection,
    forceRegenerate = false,
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

  if (!forceRegenerate) {
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
          return;
        }
        processNewSubtitles(urlForApi, videoId, messageScrapeCreatorsKey, messageOpenRouterKey, messageModelSelection, tabId);
      })
      .catch((error) => {
        console.error('Error checking storage:', error);
        processNewSubtitles(urlForApi, videoId, messageScrapeCreatorsKey, messageOpenRouterKey, messageModelSelection, tabId);
      });
  } else {
    console.log('Force regenerate subtitles requested, bypassing cache.');
    processNewSubtitles(urlForApi, videoId, messageScrapeCreatorsKey, messageOpenRouterKey, messageModelSelection, tabId);
  }
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
      throw new Error('Scrape Creators API key not found. Please set it in settings.');
    }

    // Fetch transcript
    const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
    
    // Skip if no transcript available
    if (!transcriptData || !transcriptData.segments || transcriptData.segments.length === 0) {
      console.log('No transcript available, skipping subtitle generation');
      sendStatusUpdate(tabId, 'No transcript available for this video', false, true);
      return;
    }
    
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

    // Convert Simplified Chinese to Traditional Chinese using OpenCC
    subtitles = convertSegmentsS2T(subtitles);

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
