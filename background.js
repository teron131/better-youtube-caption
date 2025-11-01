// Import utility modules
importScripts("utils/srtParser.js");
importScripts("utils/urlUtils.js");
importScripts("utils/storageManager.js");
importScripts("utils/transcriptFetcher.js");
importScripts("utils/transcriptRefiner.js");
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
  if (message.action === "fetchSubtitles") {
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
            action: "subtitlesGenerated",
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
            action: "updatePopupStatus",
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
              const modelSelection =
                messageModelSelection ||
                (await getApiKeyFromStorage("modelSelection")) ||
                "google/gemini-2.5-flash";
              
              if (openRouterKey) {
                if (tabId) {
                  chrome.runtime.sendMessage({
                    action: "updatePopupStatus",
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
                        action: "updatePopupStatus",
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
                      action: "updatePopupStatus",
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
                action: "subtitlesGenerated",
                subtitles: subtitles,
                videoId: videoId, // Pass the video ID to ensure subtitles are saved for the correct video
              }, () => {
                // Ignore errors - tab might be closed or content script not loaded
                if (chrome.runtime.lastError) {
                  console.log("Could not send message to tab (tab may be closed):", chrome.runtime.lastError.message);
                }
              });
              chrome.runtime.sendMessage({
                action: "updatePopupStatus",
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
                action: "updatePopupStatus",
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

// Fetches subtitles from the Gemini API
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
