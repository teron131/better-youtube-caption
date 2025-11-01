// Content script for YouTube Subtitles Generator
// Handles subtitle display, auto-generation, and communication with background script

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

// Loads stored subtitles for the current video from local storage
// Also checks for auto-generation setting and triggers generation if enabled
function loadStoredSubtitles() {
  try {
    const videoId = extractVideoId(window.location.href);
    
    if (!videoId) {
      console.log("Content Script: Could not extract video ID, skipping subtitle load.");
      return;
    }

    chrome.storage.local.get([
      videoId,
      STORAGE_KEYS.AUTO_GENERATE,
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.MODEL_SELECTION,
    ], (result) => {
      try {
        if (chrome.runtime.lastError) {
          console.error("Content Script: Error loading subtitles:", chrome.runtime.lastError.message);
          return;
        }

        if (result && result[videoId]) {
          console.log("Content Script: Found stored subtitles for this video.");
          currentSubtitles = result[videoId]; // Load stored subtitles
          startSubtitleDisplay(); // Start displaying the subtitles
        } else {
          console.log("Content Script: No stored subtitles found for this video.");
          
          // Check if auto-generation is enabled and hasn't been triggered for this video
          if (
            result[STORAGE_KEYS.AUTO_GENERATE] === true &&
            result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY] &&
            !autoGenerationTriggered.has(videoId)
          ) {
            console.log("Content Script: Auto-generation enabled, waiting for page to load...");
            autoGenerationTriggered.add(videoId); // Mark as triggered to prevent duplicate triggers
            
            // Wait 2-3 seconds for page to fully load before auto-generating
            setTimeout(() => {
              // Double-check video ID hasn't changed (user might have navigated away)
              const currentVideoId = extractVideoId(window.location.href);
              if (currentVideoId === videoId) {
                console.log("Content Script: Triggering auto-generation after delay...");
                triggerAutoGeneration(
                  videoId,
                  result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY],
                  result[STORAGE_KEYS.OPENROUTER_API_KEY],
                  result[STORAGE_KEYS.MODEL_SELECTION]
                );
              } else {
                console.log("Content Script: Video ID changed during delay, cancelling auto-generation");
                autoGenerationTriggered.delete(videoId); // Remove from set if video changed
              }
            }, TIMING.AUTO_GENERATION_DELAY_MS);
          }
        }
      } catch (error) {
        console.error("Content Script: Error processing stored subtitles:", error);
      }
    });
  } catch (error) {
    console.error("Content Script: Error in loadStoredSubtitles:", error);
  }
}

// Triggers automatic subtitle generation
function triggerAutoGeneration(videoId, scrapeCreatorsApiKey, openRouterApiKey, modelSelection) {
  // Clear any existing subtitles first
  clearSubtitles();
  
  // Send message to background script to fetch subtitles
  chrome.runtime.sendMessage(
    {
      action: "fetchSubtitles",
      videoId: videoId,
      scrapeCreatorsApiKey: scrapeCreatorsApiKey,
      openRouterApiKey: openRouterApiKey,
      modelSelection: modelSelection,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("Content Script: Error triggering auto-generation:", chrome.runtime.lastError.message);
      } else {
        console.log("Content Script: Auto-generation triggered successfully");
      }
    }
  );
}

// Monitors URL changes on YouTube (SPA behavior)
function monitorUrlChanges() {
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      console.log("YouTube Subtitles Generator: URL changed.");
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

// Handles actions when the URL changes
function onUrlChange() {
  console.log("YouTube Subtitles Generator: Reinitializing for new video...");
  clearSubtitles(); // Clear current subtitles
  // Note: We don't clear autoGenerationTriggered here because we want to prevent
  // re-triggering for the same video if user navigates back
  initialize(); // Reinitialize for the new video
}

// Finds video elements on the YouTube page
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

// Initializes the content script
function initialize() {
  console.log("YouTube Subtitles Generator: Initializing content script...");

  if (!findVideoElements()) {
    initAttempts++;
    if (initAttempts < TIMING.MAX_INIT_ATTEMPTS) {
      console.log(
        `Video player not found, retrying (${initAttempts}/${TIMING.MAX_INIT_ATTEMPTS})...`
      );
      setTimeout(initialize, TIMING.INIT_RETRY_DELAY_MS);
    } else {
      console.error(
        "YouTube Subtitles Generator: Video player or container not found after multiple attempts."
      );
    }
    return;
  }

  console.log("YouTube Subtitles Generator: Video player found.", videoPlayer);
  console.log(
    "YouTube Subtitles Generator: Video container found.",
    videoContainer
  );

  createSubtitleElements(); // Create subtitle elements
  loadStoredSubtitles(); // Load stored subtitles for the current video

  // Listen for messages from popup or background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.GENERATE_SUBTITLES) {
      console.log("Content Script: Received generateSubtitles request");
      
      // Use the video ID from the message if provided (captured at button click time),
      // otherwise extract from current URL
      const videoId = message.videoId || extractVideoId(window.location.href);

      if (!videoId) {
        sendResponse({
          status: "error",
          message: "Could not extract video ID from URL.",
        });
        return true;
      }

      console.log("Content Script: Sending video ID to background:", videoId);

      clearSubtitles(); // Clear previous subtitles

      // Request subtitles from background script
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
            console.error(
              "Error sending message to background:",
              chrome.runtime.lastError
            );
            sendResponse({
              status: "error",
              message: "Could not communicate with background script.",
            });
          } else {
            console.log(
              "Content Script: Message sent to background, response:",
              response
            );
          }
        }
      );

      sendResponse({ status: "started" });
      return true; // Indicate async response possible
    } else if (message.action === MESSAGE_ACTIONS.SUBTITLES_GENERATED) {
      console.log("Content Script: Received subtitlesGenerated request");
      currentSubtitles = message.subtitles || []; // Ensure it's an array
      console.log(`Received ${currentSubtitles.length} subtitle entries.`);

      if (currentSubtitles.length > 0) {
        startSubtitleDisplay(); // Start displaying subtitles

        // Store the subtitles locally for future use
        // Use the videoId from message if provided (captured at button click),
        // otherwise extract from current URL
        const videoId = message.videoId || extractVideoId(window.location.href);
        
        if (videoId) {
          chrome.storage.local.set({ [videoId]: currentSubtitles }, () => {
            if (chrome.runtime.lastError) {
              // Check if it's a quota exceeded error
              if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("QUOTA")) {
                console.warn("Storage quota exceeded. Transcript will not be saved, but subtitles will still display.");
              } else {
                console.error("Error saving subtitles:", chrome.runtime.lastError.message);
              }
            } else {
              console.log("Content Script: Subtitles saved to local storage for video ID:", videoId);
            }
          });
        } else {
          console.warn("Content Script: Could not extract video ID, subtitles not saved.");
        }

        sendResponse({ status: "success" }); // Confirm success to background
      } else {
        console.warn("Received empty subtitles array.");
        clearSubtitles(); // Ensure display is cleared if no subs found
        sendResponse({ status: "no_subtitles_found" });
      }
      return true; // Indicate response sent
    }
  });

  console.log(
    "YouTube Subtitles Generator: Initialization complete. Listening for messages."
  );
}

// Creates subtitle elements and appends them to the video container
function createSubtitleElements() {
  if (document.getElementById(ELEMENT_IDS.SUBTITLE_CONTAINER)) return;

  subtitleContainer = document.createElement("div");
  subtitleContainer.id = ELEMENT_IDS.SUBTITLE_CONTAINER;
  subtitleContainer.style.position = "absolute";
  subtitleContainer.style.zIndex = "9999";
  subtitleContainer.style.pointerEvents = "none";
  subtitleContainer.style.display = "none";

  subtitleText = document.createElement("div");
  subtitleText.id = ELEMENT_IDS.SUBTITLE_TEXT;
  subtitleContainer.appendChild(subtitleText);

  if (videoContainer) {
    if (getComputedStyle(videoContainer).position === "static") {
      videoContainer.style.position = "relative";
    }
    videoContainer.appendChild(subtitleContainer);
    console.log("Subtitle container added to video container.");
  } else {
    console.error("Cannot add subtitle container, video container not found.");
  }
}

// Starts displaying subtitles
function startSubtitleDisplay() {
  if (!videoPlayer || !subtitleContainer) {
    console.warn("Cannot start subtitle display: Player or container missing.");
    return;
  }

  stopSubtitleDisplay(); // Clear any existing interval

  console.log("Starting subtitle display interval.");
  checkInterval = setInterval(updateSubtitles, TIMING.SUBTITLE_UPDATE_INTERVAL_MS);

  videoPlayer.addEventListener("play", updateSubtitles);
  videoPlayer.addEventListener("seeked", updateSubtitles);
  videoPlayer.addEventListener("pause", hideCurrentSubtitle);
}

// Stops displaying subtitles
function stopSubtitleDisplay() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log("Stopped subtitle display interval.");
  }
  if (videoPlayer) {
    videoPlayer.removeEventListener("play", updateSubtitles);
    videoPlayer.removeEventListener("seeked", updateSubtitles);
    videoPlayer.removeEventListener("pause", hideCurrentSubtitle);
  }
}

// Clears subtitles and stops display
function clearSubtitles() {
  currentSubtitles = [];
  stopSubtitleDisplay();
  hideCurrentSubtitle();
  console.log("Subtitles cleared.");
}

// Hides the current subtitle
function hideCurrentSubtitle() {
  if (subtitleContainer) {
    subtitleContainer.style.display = "none";
  }
  if (subtitleText) {
    subtitleText.textContent = "";
  }
}

// Updates subtitles based on the current video time
function updateSubtitles() {
  if (
    !videoPlayer ||
    !subtitleText ||
    !subtitleContainer ||
    videoPlayer.paused
  ) {
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
    subtitleContainer.style.display = "block";
  } else {
    hideCurrentSubtitle();
  }
}

// --- Start Initialization ---
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initialize();
    monitorUrlChanges();
  });
} else {
  initialize();
  monitorUrlChanges();
}
