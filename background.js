// Import utility modules
importScripts("src/constants.js");
importScripts("src/parser.js");
importScripts("src/url.js");
importScripts("src/storage.js");
importScripts("src/transcript.js");
importScripts("config.js");

// Get API key with fallback to test config
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

// Listener for messages from content or popup scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === MESSAGE_ACTIONS.GENERATE_SUMMARY) {
    const {
      videoId,
      scrapeCreatorsApiKey: messageScrapeCreatorsKey,
      openRouterApiKey: messageOpenRouterKey,
      modelSelection: messageModelSelection,
    } = message;
    const tabId = sender.tab?.id;

    console.log("Background Script: Received generateSummary request for Video ID:", videoId);

    if (!videoId) {
      sendResponse({ status: "error", message: "Video ID is required." });
      return true;
    }

    const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;

    // Check if summary is already cached
    chrome.storage.local.get([`summary_${videoId}`], async (result) => {
      if (result[`summary_${videoId}`]) {
        console.log("Summary found in cache");
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "SUMMARY_GENERATED",
            summary: result[`summary_${videoId}`],
          });
        }
        sendResponse({ status: "completed", cached: true });
        return;
      }

      // Fetch transcript and generate summary
      try {
        if (tabId) {
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
            text: "Fetching YouTube transcript...",
            tabId: tabId,
          });
        }

        // Get Scrape Creators API key
        const scrapeCreatorsKey = messageScrapeCreatorsKey || (await getApiKeyWithFallback("scrapeCreatorsApiKey"));
        if (!scrapeCreatorsKey) {
          throw new Error("Scrape Creators API key not found");
        }

        // Get OpenRouter API key
        const openRouterKey = messageOpenRouterKey || (await getApiKeyWithFallback("openRouterApiKey"));
        if (!openRouterKey) {
          throw new Error("OpenRouter API key not found");
        }

        // Get model selection
        const customModel = await getApiKeyFromStorage(STORAGE_KEYS.CUSTOM_MODEL);
        const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.RECOMMENDED_MODEL);
        const modelSelection = messageModelSelection || (customModel?.trim() || recommendedModel || DEFAULTS.MODEL);

        // Fetch transcript
        const transcriptData = await fetchYouTubeTranscript(urlForApi, scrapeCreatorsKey);
        console.log(`Fetched ${transcriptData.segments.length} transcript segments for summary`);

        if (tabId) {
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
            text: "Generating summary with AI...",
            tabId: tabId,
          });
        }

        // Generate summary using OpenRouter
        const transcriptText = transcriptData.segments.map(seg => seg.text).join(' ');
        
        const summaryPrompt = `You are a helpful assistant that creates concise, informative summaries of YouTube videos.

Based on the following video transcript, create a well-structured summary in markdown format that includes:

1. A brief overview paragraph (2-3 sentences)
2. A "Key Points" section with bullet points highlighting the main topics covered

Video Title: ${transcriptData.title}
${transcriptData.description ? `Description: ${transcriptData.description}` : ''}

Transcript:
${transcriptText}

Format your response in markdown with clear sections.`;

        const summaryResponse = await fetch(API_ENDPOINTS.OPENROUTER, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://github.com/better-youtube-caption',
            'X-Title': 'Better YouTube Caption'
          },
          body: JSON.stringify({
            model: modelSelection,
            messages: [
              {
                role: 'user',
                content: summaryPrompt
              }
            ]
          })
        });

        if (!summaryResponse.ok) {
          throw new Error(`OpenRouter API error: ${summaryResponse.status}`);
        }

        const summaryData = await summaryResponse.json();
        const summary = summaryData.choices[0].message.content;

        // Save summary to storage
        chrome.storage.local.set({ [`summary_${videoId}`]: summary });

        // Send summary to content script/popup
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "SUMMARY_GENERATED",
            summary: summary,
          });
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
            text: "Summary generated successfully!",
            success: true,
            tabId: tabId,
          });
        }

        sendResponse({ status: "completed" });
      } catch (error) {
        console.error("Error generating summary:", error);
        const errorMessage = `Error: ${error.message || "Unknown error"}`;
        if (tabId) {
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
            text: errorMessage,
            error: true,
            tabId: tabId,
          });
        }
        sendResponse({ status: "error", message: error.message });
      }
    });

    return true; // Keep channel open for async response
  } else if (message.action === MESSAGE_ACTIONS.FETCH_SUBTITLES) {
    const {
      videoId, // Video ID - URL will be constructed from this when needed
      scrapeCreatorsApiKey: messageScrapeCreatorsKey,
      openRouterApiKey: messageOpenRouterKey,
      modelSelection: messageModelSelection,
    } = message;
    const tabId = sender.tab?.id;

    console.log(
      "Background Script: Received fetchSubtitles request for Video ID:",
      videoId
    );

    if (!videoId) {
      sendResponse({ status: "error", message: "Video ID is required." });
      return true;
    }

    // Construct URL from video ID for API calls
    const urlForApi = `https://www.youtube.com/watch?v=${videoId}`;

    console.log("Background Script: Using URL for API:", urlForApi);

    // Check if subtitles for this video are already stored locally (using video ID)
    getStoredSubtitles(videoId)
      .then((cachedSubtitles) => {
        if (cachedSubtitles) {
        console.log("Subtitles found in local storage for this video.");
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: MESSAGE_ACTIONS.SUBTITLES_GENERATED,
              subtitles: cachedSubtitles,
              videoId: videoId, // Pass the video ID to ensure subtitles are for the correct video
          }, () => {
            // Ignore errors - tab might be closed or content script not loaded
            if (chrome.runtime.lastError) {
              console.log("Could not send message to tab (tab may be closed):", chrome.runtime.lastError.message);
            }
          });
        }
        sendResponse({ status: "completed", cached: true });
      } else {
          console.log("No cached subtitles found. Fetching transcript...");

        if (tabId) {
          chrome.runtime.sendMessage({
            action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
              text: "Fetching YouTube transcript...",
            tabId: tabId,
          }, () => {
            // Ignore errors - popup might be closed
            if (chrome.runtime.lastError) {
              // Popup might be closed, ignore
            }
          });
        }

          // First, fetch transcript from Scrape Creators API
          (async () => {
            // Get Scrape Creators API key - use message value if provided, otherwise fallback to storage/config
            const scrapeCreatorsKey =
              messageScrapeCreatorsKey ||
              (await getApiKeyWithFallback("scrapeCreatorsApiKey"));
            if (!scrapeCreatorsKey) {
              throw new Error("Scrape Creators API key not found. Please set it in config.js or popup.");
            }
            return scrapeCreatorsKey;
          })()
            .then((key) => fetchYouTubeTranscript(urlForApi, key))
            .then(async (transcriptData) => {
              console.log(`Fetched ${transcriptData.segments.length} transcript segments`);
              console.log(`Video title: ${transcriptData.title}`);
              
              // Enhance segments with startTimeText for formatting
              const enhancedSegments = transcriptData.segments.map((seg) => {
                // Calculate startTimeText from startTime if not available
                const startTimeText = seg.startTimeText || formatTimestamp(seg.startTime);
                return {
                  ...seg,
                  startTimeText: startTimeText,
                };
              });
              
              // Refine transcript using AI if OpenRouter API key is available
              // Get OpenRouter API key - use message value if provided, otherwise fallback to storage/config
              const openRouterKey =
                messageOpenRouterKey ||
                (await getApiKeyWithFallback("openRouterApiKey"));
              
              // Get model selection - use message value if provided, otherwise fallback to storage
              // Priority: custom model > recommended model > default
              const customModel = await getApiKeyFromStorage(STORAGE_KEYS.CUSTOM_MODEL);
              const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.RECOMMENDED_MODEL);
              const modelSelection =
                messageModelSelection ||
                (customModel?.trim() || recommendedModel || DEFAULTS.MODEL);
              
              if (openRouterKey) {
                if (tabId) {
                  chrome.runtime.sendMessage({
                    action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
                    text: "Refining transcript with AI...",
                    tabId: tabId,
                  }, () => {
                    if (chrome.runtime.lastError) {
                      // Popup might be closed, ignore
                    }
                  });
                }
                
                try {
                  const progressCallback = (message) => {
                    if (tabId) {
                      chrome.runtime.sendMessage({
                        action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
                        text: message,
                        tabId: tabId,
                      }, () => {
                        if (chrome.runtime.lastError) {
                          // Popup might be closed, ignore
                        }
                      });
                    }
                  };
                  
                  const refinedSegments = await refineTranscriptSegments(
                    enhancedSegments,
                    transcriptData.title,
                    transcriptData.description,
                    openRouterKey,
                    progressCallback,
                    modelSelection
                  );
                  
                  console.log(`Refined ${refinedSegments.length} transcript segments`);
                  return refinedSegments;
                } catch (refinementError) {
                  console.warn("Transcript refinement failed, using original:", refinementError);
                  if (tabId) {
                    chrome.runtime.sendMessage({
                      action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
                      text: "Using original transcript (refinement failed)",
                      tabId: tabId,
                    }, () => {
                      if (chrome.runtime.lastError) {
                        // Popup might be closed, ignore
                      }
                    });
                  }
                  // Fallback to original segments if refinement fails
                  return enhancedSegments;
                }
              } else {
                console.log("OpenRouter API key not found, skipping refinement");
                return enhancedSegments;
              }
            })
          .then((subtitles) => {
            if (tabId) {
              chrome.tabs.sendMessage(tabId, {
                action: MESSAGE_ACTIONS.SUBTITLES_GENERATED,
                subtitles: subtitles,
                videoId: videoId, // Pass the video ID to ensure subtitles are saved for the correct video
              }, () => {
                // Ignore errors - tab might be closed or content script not loaded
                if (chrome.runtime.lastError) {
                  console.log("Could not send message to tab (tab may be closed):", chrome.runtime.lastError.message);
                }
              });
              chrome.runtime.sendMessage({
                action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
                  text: "Transcript fetched and ready!",
                success: true,
                tabId: tabId,
              }, () => {
                // Ignore errors - popup might be closed
                if (chrome.runtime.lastError) {
                  // Popup might be closed, ignore
                }
              });
            }

              // Check storage space before saving
              return ensureStorageSpace()
                .then(() => saveSubtitles(videoId, subtitles))
                .catch((storageError) => {
                  console.warn("Storage management failed:", storageError);
                  // Still try to save - let saveSubtitles handle the error
                  return saveSubtitles(videoId, subtitles);
                });
            })
            .then(() => {
            sendResponse({ status: "completed" });
          })
          .catch((error) => {
            console.error("Error fetching/parsing subtitles:", error);
            const errorMessage = `Error: ${
              error.message || "Unknown error fetching subtitles."
            }`;
            if (tabId) {
              chrome.runtime.sendMessage({
                action: MESSAGE_ACTIONS.UPDATE_POPUP_STATUS,
                text: errorMessage,
                error: true,
                tabId: tabId,
              }, () => {
                if (chrome.runtime.lastError) {
                  // Popup might be closed, ignore
                }
              });
            }
            sendResponse({ status: "error", message: error.message });
          });
      }
      })
      .catch((error) => {
        console.error("Error checking storage:", error);
        sendResponse({ status: "error", message: error.message });
    });

    return true; // Keep the message channel open for async response
  }
});

// Note: Video IDs are now used for storage instead of URLs for better robustness
// The fetchSubtitlesFromGemini function below is kept for reference but is not currently used
// The extension now uses Scrape Creators API + OpenRouter for transcript refinement

// Fetches subtitles from the Gemini API (DEPRECATED - not used)
async function fetchSubtitlesFromGemini(videoUrl, apiKey, tabId) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-exp-03-25:generateContent?key=${apiKey}`;

  console.log(
    "Background Script: URL being embedded in Gemini prompt:",
    videoUrl
  );

  const prompt = `Generate ONLY the SRT subtitles for the YouTube video.\nDo NOT include any introductory text, explanations, or summaries.\nThe output MUST strictly follow the Standard SRT format:\n1\n00:00:01,000 --> 00:00:05,000\nSubtitle text line 1\nSubtitle text line 2 (if needed).\nEnsure timestamps use milliseconds (,) and sequential numbering is correct. Ensure time stamps are in the following format: HH:MM,ms, example: 00:00:01,000. DO NOT recite training data in the prompt.`;

  if (tabId) {
    chrome.runtime.sendMessage({
      action: "updatePopupStatus",
      text: "Waiting for Gemini response...",
      tabId: tabId,
    });
  }

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }, { file_data: { file_uri: `${videoUrl}` } }],
        },
      ],
    }),
  });

  if (!response.ok) {
    let errorData;
    try {
      errorData = await response.json();
      console.error("Gemini API Error Response:", errorData);
    } catch (e) {
      console.error(
        "Failed to parse Gemini error response:",
        await response.text()
      );
      throw new Error(
        `Gemini API request failed with status ${response.status}`
      );
    }
    throw new Error(
      `Gemini API error: ${
        errorData?.error?.message || `Status ${response.status}`
      }`
    );
  }

  const data = await response.json();
  console.log("Gemini API Success Response:", JSON.stringify(data, null, 2));

  if (tabId) {
    chrome.runtime.sendMessage({
      action: "updatePopupStatus",
      text: "Parsing Gemini response...",
      tabId: tabId,
    });
  }

  let srtText = "";
  if (
    data &&
    data.candidates &&
    data.candidates.length > 0 &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.length > 0 &&
    data.candidates[0].content.parts[0].text
  ) {
    srtText = data.candidates[0].content.parts[0].text;

    const codeBlockMatch = srtText.match(/```(?:srt)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      console.log("Extracted SRT from markdown code block.");
      srtText = codeBlockMatch[1];
    }
  } else if (data?.promptFeedback?.blockReason) {
    console.error("Gemini response blocked:", data.promptFeedback.blockReason);
    throw new Error(
      `Content blocked by Gemini: ${data.promptFeedback.blockReason}`
    );
  } else {
    console.error("Could not find text part in Gemini response:", data);
    throw new Error("Invalid response format from Gemini API.");
  }

  const parsedSubtitles = parseSrt(srtText);

  if (parsedSubtitles.length === 0 && srtText.trim().length > 0) {
    console.warn(
      "SRT parsing yielded no results. The response might not be valid SRT."
    );
  }

  return parsedSubtitles;
}
