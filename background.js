function timeStringToMs(timeStr) {
  if (!timeStr) return 0;

  // Trim whitespace from the start and end
  const trimmedTimeStr = timeStr.trim();

  // First try to match HH:MM:SS,ms format
  let match = trimmedTimeStr.match(
    /(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})[.,](\d{3})/
  );

  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const milliseconds = parseInt(match[4], 10);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
  }

  // If that doesn't match, try MM:SS,ms format (missing hours)
  match = trimmedTimeStr.match(/(\d{2})\s*:\s*(\d{2})[.,](\d{3})/);

  if (match) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const milliseconds = parseInt(match[3], 10);
    return minutes * 60000 + seconds * 1000 + milliseconds;
  }

  // Log the string that failed to parse for easier debugging
  console.warn("Could not parse time string:", `"${trimmedTimeStr}"`);
  return 0;
}

function parseSrt(srtText) {
  if (!srtText || typeof srtText !== "string") {
    console.error("Invalid SRT text input:", srtText);
    return [];
  }

  console.log("Attempting to parse SRT:\n", srtText);

  const subtitles = [];
  // Regex to match SRT blocks: index, timestamp, text lines
  // Handles potential variations in line breaks and spacing
  const srtBlockRegex =
    /(\d+)\s*([\d:,.-]+)\s*-->\s*([\d:,.-]+)\s*((?:.|\n(?!(\d+\s*[\d:,.-]+\s*-->)))+)/g;
  // Explanation:
  // (\d+)                     - Capture group 1: Subtitle index (numeric)
  // \s* - Optional whitespace
  // ([\d:,.-]+)               - Capture group 2: Start timestamp (digits, :, ,, .)
  // \s*-->\s* - Arrow separator with optional whitespace
  // ([\d:,.-]+)               - Capture group 3: End timestamp
  // \s* - Optional whitespace
  // (                         - Capture group 4: Subtitle text
  //   (?:.|\n                - Match any character OR a newline...
  //      (?!                 - ...IF that newline is NOT followed by:
  //         (\d+\s* - A potential next subtitle index number
  //         [\d:,.-]+\s*-->) - and a timestamp line start
  //      )
  //   )
  // )+                        - Match one or more characters/lines of text

  let match;
  while ((match = srtBlockRegex.exec(srtText)) !== null) {
    const index = parseInt(match[1], 10);
    const startTimeStr = match[2].trim().replace(".", ","); // Normalize to comma
    const endTimeStr = match[3].trim().replace(".", ","); // Normalize to comma
    const text = match[4].trim().replace(/[\r\n]+/g, " "); // Join multi-line text

    const startTime = timeStringToMs(startTimeStr);
    const endTime = timeStringToMs(endTimeStr);

    // Basic validation
    if (!isNaN(startTime) && !isNaN(endTime) && text) {
      subtitles.push({
        startTime,
        endTime,
        text,
      });
    } else {
      console.warn(
        `Skipping malformed SRT block near index ${index}:`,
        match[0]
      );
    }
  }

  if (subtitles.length === 0 && srtText.trim().length > 0) {
    console.warn("Could not parse any valid SRT blocks from the text.");
    // TODO: Handle model response other than SRT (e.g., an error message)
  }

  console.log("Parsed subtitles count:", subtitles.length);
  return subtitles;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchSubtitles") {
    const { videoUrl, apiKey } = message;
    const tabId = sender.tab?.id; // Get tab ID for sending updates

    console.log(
      "Background Script: Received fetchSubtitles request for URL:",
      videoUrl
    );

    const cleanedUrl = cleanYouTubeUrl(videoUrl);
    console.log("Background Script: Using cleaned URL for API:", cleanedUrl);

    // Check if subtitles for this video are already stored locally
    chrome.storage.local.get(cleanedUrl, (result) => {
      if (result[cleanedUrl]) {
        console.log("Subtitles found in local storage for this video.");
        // Send the stored subtitles to the content script
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "subtitlesGenerated",
            subtitles: result[cleanedUrl],
          });
        }
        sendResponse({ status: "completed", cached: true });
      } else {
        console.log("No cached subtitles found. Fetching from Gemini API...");

        // Notify popup that fetching has started
        if (tabId) {
          chrome.runtime.sendMessage({
            action: "updatePopupStatus",
            text: "Calling Gemini API...",
            tabId: tabId,
          });
        }

        fetchSubtitlesFromGemini(cleanedUrl, apiKey, tabId)
          .then((subtitles) => {
            if (tabId) {
              // Send subtitles to content script
              chrome.tabs.sendMessage(tabId, {
                action: "subtitlesGenerated",
                subtitles: subtitles,
              });
              // Notify popup of success
              chrome.runtime.sendMessage({
                action: "updatePopupStatus",
                text: "Subtitles generated!",
                success: true,
                tabId: tabId,
              });
            }

            // Store the subtitles locally for future use
            chrome.storage.local.set({ [cleanedUrl]: subtitles }, () => {
              console.log("Subtitles saved to local storage for:", cleanedUrl);
            });

            sendResponse({ status: "completed" });
          })
          .catch((error) => {
            console.error("Error fetching/parsing subtitles:", error);
            const errorMessage = `Error: ${
              error.message || "Unknown error fetching subtitles."
            }`;
            // Notify popup of error
            if (tabId) {
              chrome.runtime.sendMessage({
                action: "updatePopupStatus",
                text: errorMessage,
                error: true,
                tabId: tabId,
              });
            }
            // Respond to original sender (content script)
            sendResponse({ status: "error", message: error.message });
          });
      }
    });

    return true; // Keep the message channel open for async response
  }
});

function cleanYouTubeUrl(originalUrl) {
  try {
    const url = new URL(originalUrl);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      // Reconstruct a minimal URL
      return `${url.protocol}//${url.hostname}${url.pathname}?v=${videoId}`;
    }
  } catch (e) {
    console.error("Error parsing URL for cleaning:", originalUrl, e);
  }
  // Fallback to original if cleaning fails or no 'v' param found
  return originalUrl;
}

async function fetchSubtitlesFromGemini(videoUrl, apiKey, tabId) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-exp-03-25:generateContent?key=${apiKey}`;

  console.log(
    "Background Script: URL being embedded in Gemini prompt:",
    videoUrl
  );

  const prompt = `Generate ONLY the SRT subtitles for the YouTube video.\nDo NOT include any introductory text, explanations, or summaries.\nThe output MUST strictly follow the Standard SRT format:\n1\n00:00:01,000 --> 00:00:05,000\nSubtitle text line 1\nSubtitle text line 2 (if needed).\nEnsure timestamps use milliseconds (,) and sequential numbering is correct. Ensure time stamps are in the following format: HH:MM,ms, example: 00:00:01,000. DO NOT recite training data in the prompt.
  `;

  // Notify popup
  if (tabId) {
    chrome.runtime.sendMessage({
      action: "updatePopupStatus",
      text: "Waiting for Gemini response...",
      tabId: tabId,
    });
  }

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
            {
              file_data: {
                file_uri: `${videoUrl}`,
              },
            },
          ],
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
  console.log("Gemini API Success Response:", JSON.stringify(data, null, 2)); // Log the full response

  // Notify popup
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

    // Sometimes Gemini might wrap the SRT in markdown code blocks
    const codeBlockMatch = srtText.match(/```(?:srt)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      console.log("Extracted SRT from markdown code block.");
      srtText = codeBlockMatch[1];
    }
  } else if (data?.promptFeedback?.blockReason) {
    // Handle cases where content was blocked by safety settings
    console.error(
      "Gemini response blocked:",
      data.promptFeedback.blockReason,
      data.promptFeedback.safetyRatings
    );
    throw new Error(
      `Content blocked by Gemini: ${data.promptFeedback.blockReason}`
    );
  } else {
    console.error("Could not find text part in Gemini response:", data);
    throw new Error("Invalid response format from Gemini API.");
  }

  // Parse SRT text into structured format
  const parsedSubtitles = parseSrt(srtText);

  if (parsedSubtitles.length === 0 && srtText.trim().length > 0) {
    // If parsing failed but we got *some* text back from Gemini
    console.warn(
      "SRT parsing yielded no results. The response might not be valid SRT."
    );
    // Optionally, you could throw an error here to indicate failure clearly
    // throw new Error("Failed to parse valid SRT data from Gemini response.");
  }

  return parsedSubtitles;
}
