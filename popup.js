document.addEventListener("DOMContentLoaded", function () {
  // DOM elements
  const scrapeCreatorsApiKeyInput = document.getElementById("scrapeCreatorsApiKey");
  const openRouterApiKeyInput = document.getElementById("openRouterApiKey");
  const modelSelectionInput = document.getElementById("modelSelection");
  const autoGenerateToggle = document.getElementById("autoGenerateToggle");
  const generateBtn = document.getElementById("generateBtn");
  const statusDiv = document.getElementById("status");

  // Create a div for displaying existing subtitles message
  const existingSubtitlesDiv = document.createElement("div");
  existingSubtitlesDiv.id = "existingSubtitles";
  existingSubtitlesDiv.style.marginTop = "10px";
  existingSubtitlesDiv.style.color = "green";
  generateBtn.parentNode.insertBefore(
    existingSubtitlesDiv,
    generateBtn.nextSibling
  ); // Add it below the button

  // Load saved API keys, model, and auto-generation setting from local storage
  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.MODEL_SELECTION,
      STORAGE_KEYS.AUTO_GENERATE,
    ],
    function (result) {
      if (result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]) {
        scrapeCreatorsApiKeyInput.value = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
      }
      if (result[STORAGE_KEYS.OPENROUTER_API_KEY]) {
        openRouterApiKeyInput.value = result[STORAGE_KEYS.OPENROUTER_API_KEY];
      }
      if (result[STORAGE_KEYS.MODEL_SELECTION]) {
        modelSelectionInput.value = result[STORAGE_KEYS.MODEL_SELECTION];
      } else {
        // Set default model if not set
        modelSelectionInput.value = DEFAULTS.MODEL;
      }
      // Load auto-generation setting (default to false)
      autoGenerateToggle.checked = result[STORAGE_KEYS.AUTO_GENERATE] === true;
    }
  );

  // Check if subtitles already exist for the current video
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {

    const currentTab = tabs[0];

    if (currentTab && currentTab.url && currentTab.url.includes("youtube")) {
      const videoId = extractVideoId(currentTab.url);
      console.log("Video ID:", videoId);

      if (videoId) {
        chrome.storage.local.get([videoId], function (result) {
          if (result[videoId]) {
            existingSubtitlesDiv.textContent =
              "Subtitles already exist for this video. 🚀";
          } else {
            existingSubtitlesDiv.textContent = ""; // Clear the message if no subtitles exist
          }
        });
      }
    }
  });

  // Handle auto-generation toggle change
  autoGenerateToggle.addEventListener("change", function () {
    chrome.storage.local.set({ [STORAGE_KEYS.AUTO_GENERATE]: autoGenerateToggle.checked }, () => {
      console.log("Auto-generation setting saved:", autoGenerateToggle.checked);
    });
  });

  // Handle the "Generate Subtitles" button click
  generateBtn.addEventListener("click", function () {
    // Prevent multiple clicks while processing
    if (generateBtn.disabled) {
      return;
    }

    const scrapeCreatorsApiKey = scrapeCreatorsApiKeyInput.value.trim();
    const openRouterApiKey = openRouterApiKeyInput.value.trim();
    const modelSelection = modelSelectionInput.value.trim() || DEFAULTS.MODEL;
    
    statusDiv.textContent = ""; // Clear previous status

    if (!scrapeCreatorsApiKey) {
      statusDiv.textContent = "Please enter a Scrape Creators API key";
      return;
    }

    // Save the API keys, model, and auto-generation setting to local storage
    chrome.storage.local.set({
      [STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]: scrapeCreatorsApiKey,
      [STORAGE_KEYS.OPENROUTER_API_KEY]: openRouterApiKey,
      [STORAGE_KEYS.MODEL_SELECTION]: modelSelection,
      [STORAGE_KEYS.AUTO_GENERATE]: autoGenerateToggle.checked,
    });

    // Show loading status
    statusDiv.textContent = "Requesting subtitles...";
    generateBtn.disabled = true; // Disable button during processing

    // Query the active tab and capture video URL immediately
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];
      console.log(
        "Popup: Active tab URL:",
        currentTab ? currentTab.url : "No tab found"
      );

      if (
        currentTab &&
        currentTab.url &&
        currentTab.url.includes("youtube.com/watch")
      ) {
        // Helper function to extract video ID from YouTube URL
        function extractVideoId(url) {
          try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get("v");
          } catch (e) {
            console.error("Error extracting video ID:", url, e);
            return null;
          }
        }

        // Extract video ID at button click time to ensure it sticks to the clicked video
        const videoId = extractVideoId(currentTab.url);
        
        if (!videoId) {
          statusDiv.textContent = "Error: Could not extract video ID from URL.";
          generateBtn.disabled = false;
          return;
        }
        
        // Send a message to the content script to generate subtitles
        chrome.tabs.sendMessage(
          currentTab.id,
          {
            action: MESSAGE_ACTIONS.GENERATE_SUBTITLES,
            videoId: videoId, // Pass only the video ID
            scrapeCreatorsApiKey: scrapeCreatorsApiKey,
            openRouterApiKey: openRouterApiKey,
            modelSelection: modelSelection,
          },
          function (response) {
            if (chrome.runtime.lastError) {
              console.error("Popup Error:", chrome.runtime.lastError.message);
              statusDiv.textContent = `Error: ${chrome.runtime.lastError.message}. Try reloading the YouTube page.`;
              generateBtn.disabled = false;
            } else if (response && response.status === "started") {
              statusDiv.textContent =
                "Processing video... (This may take a while)";
            } else if (response && response.status === "error") {
              statusDiv.textContent = `Error: ${
                response.message || "Could not start process."
              }`;
              generateBtn.disabled = false;
            } else {
              statusDiv.textContent =
                "Error: Unexpected response from content script.";
              generateBtn.disabled = false;
            }
          }
        );
      } else {
        statusDiv.textContent = "Not a YouTube video page.";
        generateBtn.disabled = false;
      }
    });
  });

  // Listen for status updates from the background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      statusDiv.textContent = message.text;
      if (message.error || message.success) {
        generateBtn.disabled = false; // Re-enable button on completion or error
      }
    }
  });
});
