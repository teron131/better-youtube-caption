// Import utility modules
importScripts("utils/srtParser.js");
importScripts("utils/urlUtils.js");
importScripts("utils/storageManager.js");
importScripts("utils/transcriptFetcher.js");
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
    const { videoUrl, apiKey } = message;
    const tabId = sender.tab?.id;

    console.log(
      "Background Script: Received fetchSubtitles request for URL:",
      videoUrl
    );

    const cleanedUrl = cleanYouTubeUrl(videoUrl);
    console.log("Background Script: Using cleaned URL for API:", cleanedUrl);

    // Check if subtitles for this video are already stored locally
    getStoredSubtitles(cleanedUrl)
      .then((cachedSubtitles) => {
        if (cachedSubtitles) {
        console.log("Subtitles found in local storage for this video.");
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "subtitlesGenerated",
              subtitles: cachedSubtitles,
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
          });
        }

          // First, fetch transcript from Scrape Creators API
          (async () => {
            // Get Scrape Creators API key
            const scrapeCreatorsKey = await getApiKeyWithFallback("scrapeCreatorsApiKey");
            if (!scrapeCreatorsKey) {
              throw new Error("Scrape Creators API key not found. Please set it in config.js or popup.");
            }
            return scrapeCreatorsKey;
          })()
            .then((key) => fetchYouTubeTranscript(cleanedUrl, key))
            .then((transcriptData) => {
              console.log(`Fetched ${transcriptData.segments.length} transcript segments`);
              console.log(`Video title: ${transcriptData.title}`);
              
              // For now, return transcript segments directly (refinement will be added later)
              // The transcript segments are already in the correct format: {startTime, endTime, text}
              // Metadata (title, description, transcriptText) is available for future refinement
              return transcriptData.segments;
            })
          .then((subtitles) => {
            if (tabId) {
              chrome.tabs.sendMessage(tabId, {
                action: "subtitlesGenerated",
                subtitles: subtitles,
              });
              chrome.runtime.sendMessage({
                action: "updatePopupStatus",
                  text: "Transcript fetched and ready!",
                success: true,
                tabId: tabId,
              });
            }

              return saveSubtitles(cleanedUrl, subtitles);
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

// Note: cleanYouTubeUrl is now imported from utils/urlUtils.js

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
