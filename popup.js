document.addEventListener("DOMContentLoaded", function () {
  // DOM elements
  const scrapeCreatorsApiKeyInput = document.getElementById("scrapeCreatorsApiKey");
  const openRouterApiKeyInput = document.getElementById("openRouterApiKey");
  const modelSelectionInput = document.getElementById("modelSelection");
  const autoGenerateToggle = document.getElementById("autoGenerateToggle");
  const showSubtitlesToggle = document.getElementById("showSubtitlesToggle");
  const generateBtn = document.getElementById("generateBtn");
  const statusDiv = document.getElementById("status");
  const settingsButton = document.getElementById("settingsButton");
  const backButton = document.getElementById("backButton");
  const mainView = document.getElementById("mainView");
  const settingsView = document.getElementById("settingsView");

  // View management
  function showView(viewId) {
    mainView.classList.remove("active");
    settingsView.classList.remove("active");
    if (viewId === "main") {
      mainView.classList.add("active");
    } else if (viewId === "settings") {
      settingsView.classList.add("active");
    }
  }

  settingsButton.addEventListener("click", () => {
    showView("settings");
  });

  backButton.addEventListener("click", () => {
    showView("main");
  });

  // Create a div for displaying existing subtitles message
  const existingSubtitlesDiv = document.createElement("div");
  existingSubtitlesDiv.id = "existingSubtitles";
  existingSubtitlesDiv.style.marginTop = "10px";
  existingSubtitlesDiv.style.color = "green";
  generateBtn.parentNode.insertBefore(
    existingSubtitlesDiv,
    generateBtn.nextSibling
  ); // Add it below the button

  // Load saved API keys, model, and settings from local storage
  chrome.storage.local.get(
    [
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.MODEL_SELECTION,
      STORAGE_KEYS.AUTO_GENERATE,
      STORAGE_KEYS.SHOW_SUBTITLES,
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
      // Load show subtitles setting (default to true)
      showSubtitlesToggle.checked = result[STORAGE_KEYS.SHOW_SUBTITLES] !== false;
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

  // Handle show subtitles toggle change
  showSubtitlesToggle.addEventListener("change", function () {
    chrome.storage.local.set({ [STORAGE_KEYS.SHOW_SUBTITLES]: showSubtitlesToggle.checked }, () => {
      console.log("Show subtitles setting saved:", showSubtitlesToggle.checked);
      
      // Send message to content script to toggle subtitle display
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const currentTab = tabs[0];
        if (currentTab && currentTab.url && currentTab.url.includes("youtube.com/watch")) {
          chrome.tabs.sendMessage(
            currentTab.id,
            {
              action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
              showSubtitles: showSubtitlesToggle.checked,
            },
            () => {
              if (chrome.runtime.lastError) {
                console.log("Could not send toggle message to content script:", chrome.runtime.lastError.message);
              }
            }
          );
        }
      });
    });
  });

  // Handle settings changes - save to storage when changed
  scrapeCreatorsApiKeyInput.addEventListener("change", function () {
    chrome.storage.local.set({ [STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]: scrapeCreatorsApiKeyInput.value.trim() });
  });

  openRouterApiKeyInput.addEventListener("change", function () {
    chrome.storage.local.set({ [STORAGE_KEYS.OPENROUTER_API_KEY]: openRouterApiKeyInput.value.trim() });
  });

  modelSelectionInput.addEventListener("change", function () {
    chrome.storage.local.set({ [STORAGE_KEYS.MODEL_SELECTION]: modelSelectionInput.value.trim() || DEFAULTS.MODEL });
  });

  // Handle the "Generate Subtitles" button click
  generateBtn.addEventListener("click", function () {
    // Prevent multiple clicks while processing
    if (generateBtn.disabled) {
      return;
    }

    statusDiv.textContent = ""; // Clear previous status

    // Get API keys from storage (they are saved in settings)
    chrome.storage.local.get([
      STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
      STORAGE_KEYS.OPENROUTER_API_KEY,
      STORAGE_KEYS.MODEL_SELECTION,
    ], (result) => {
      const scrapeCreatorsApiKey = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
      const openRouterApiKey = result[STORAGE_KEYS.OPENROUTER_API_KEY];
      const modelSelection = result[STORAGE_KEYS.MODEL_SELECTION] || DEFAULTS.MODEL;

      if (!scrapeCreatorsApiKey) {
        statusDiv.textContent = "Please enter a Scrape Creators API key in Settings";
        showView("settings"); // Switch to settings if API key is missing
        return;
      }

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
