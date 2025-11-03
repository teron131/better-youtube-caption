document.addEventListener("DOMContentLoaded", function () {
  // DOM Elements
  const mainView = document.getElementById("mainView");
  const settingsView = document.getElementById("settingsView");
  const settingsBtn = document.getElementById("settingsBtn");
  const backBtn = document.getElementById("backBtn");
  const generateBtn = document.getElementById("generateBtn");
  const saveBtn = document.getElementById("saveBtn");
  const videoTitle = document.getElementById("videoTitle");
  const summaryContent = document.getElementById("summaryContent");
  const status = document.getElementById("status");
  const settingsStatus = document.getElementById("settingsStatus");

  // Form inputs
  const scrapeApiKey = document.getElementById("scrapeApiKey");
  const openrouterApiKey = document.getElementById("openrouterApiKey");
  const recommendedModel = document.getElementById("recommendedModel");
  const customModel = document.getElementById("customModel");
  const autoGenerateToggle = document.getElementById("autoGenerateToggle");
  const showSubtitlesToggle = document.getElementById("showSubtitlesToggle");

  function addModelOption(value, label) {
    if (!recommendedModel || !value) return;

    const exists = Array.from(recommendedModel.options).some(
      (option) => option.value === value
    );

    if (!exists) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label || value;
      recommendedModel.appendChild(option);
    }
  }

  function getModelLabel(value) {
    if (!Array.isArray(RECOMMENDED_MODELS)) {
      return value;
    }

    const match = RECOMMENDED_MODELS.find((model) => model.value === value);
    return match ? match.label : value;
  }

  function populateModelOptions() {
    if (!recommendedModel) return;

    recommendedModel.innerHTML = "";

    if (Array.isArray(RECOMMENDED_MODELS) && RECOMMENDED_MODELS.length > 0) {
      RECOMMENDED_MODELS.forEach((model) => {
        addModelOption(model.value, model.label);
      });
    }

    if (DEFAULTS && DEFAULTS.MODEL) {
      addModelOption(DEFAULTS.MODEL, getModelLabel(DEFAULTS.MODEL));
    }
  }

  function sanitizeTitle(title) {
    if (typeof title !== "string") {
      return "";
    }

    return title
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*-\s*YouTube$/i, "")
      .trim();
  }

  let currentVideoId = null;
  let currentVideoTitle = null;

  // View Management
  function showMainView() {
    mainView.classList.add("active");
    settingsView.classList.remove("active");
  }

  function showSettingsView() {
    mainView.classList.remove("active");
    settingsView.classList.add("active");
  }

  settingsBtn.addEventListener("click", showSettingsView);
  backBtn.addEventListener("click", showMainView);

  // Handle main view toggle for Show Subtitles
  if (showSubtitlesToggle) {
    showSubtitlesToggle.addEventListener("change", function () {
      const enabled = showSubtitlesToggle.checked;
      chrome.storage.local.set({ [STORAGE_KEYS.SHOW_SUBTITLES]: enabled }, function () {
        // Send message to content script to toggle subtitles
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes("youtube.com")) {
            chrome.tabs.sendMessage(
              currentTab.id,
              {
                action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
                showSubtitles: enabled,
                enabled: enabled,
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.debug(
                    "Popup: Unable to toggle subtitles:",
                    chrome.runtime.lastError.message
                  );
                }
              }
            );
          }
        });
      });
    });
  }

  // Load Settings
  function loadSettings() {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
        STORAGE_KEYS.OPENROUTER_API_KEY,
        STORAGE_KEYS.RECOMMENDED_MODEL,
        STORAGE_KEYS.CUSTOM_MODEL,
        STORAGE_KEYS.AUTO_GENERATE,
        STORAGE_KEYS.SHOW_SUBTITLES,
      ],
      function (result) {
        if (result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]) {
          scrapeApiKey.value = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
        }
        if (result[STORAGE_KEYS.OPENROUTER_API_KEY]) {
          openrouterApiKey.value = result[STORAGE_KEYS.OPENROUTER_API_KEY];
        }

        const storedModel = result[STORAGE_KEYS.RECOMMENDED_MODEL];
        const defaultModel = DEFAULTS ? DEFAULTS.MODEL : "";
        
        // Validate stored model - check if it exists in RECOMMENDED_MODELS
        const isValidModel = storedModel && Array.isArray(RECOMMENDED_MODELS) && 
          RECOMMENDED_MODELS.some((model) => model.value === storedModel);
        
        // If stored model is invalid, clear it and use default
        let activeModel = storedModel;
        if (storedModel && !isValidModel) {
          console.log(`Popup: Clearing invalid stored model: ${storedModel}`);
          activeModel = defaultModel;
          // Clear the invalid value from storage
          chrome.storage.local.set({ [STORAGE_KEYS.RECOMMENDED_MODEL]: defaultModel });
        } else if (!storedModel) {
          activeModel = defaultModel;
        }

        if (recommendedModel) {
          recommendedModel.value = activeModel;

          if (!recommendedModel.value && defaultModel) {
            recommendedModel.value = defaultModel;
          }
        }

        if (result[STORAGE_KEYS.CUSTOM_MODEL]) {
          customModel.value = result[STORAGE_KEYS.CUSTOM_MODEL];
        }
        autoGenerateToggle.checked = result[STORAGE_KEYS.AUTO_GENERATE] === true;
        const showSubtitlesValue =
          result[STORAGE_KEYS.SHOW_SUBTITLES] !== undefined
            ? result[STORAGE_KEYS.SHOW_SUBTITLES]
            : DEFAULTS.SHOW_SUBTITLES;
        if (showSubtitlesToggle) {
          showSubtitlesToggle.checked = showSubtitlesValue === true;
        }
      }
    );
  }

  // Save Settings
  saveBtn.addEventListener("click", function () {
    const selectedModelRaw = recommendedModel && recommendedModel.value ? recommendedModel.value : DEFAULTS.MODEL;
    const selectedModel = typeof selectedModelRaw === "string" && selectedModelRaw.trim()
      ? selectedModelRaw.trim()
      : DEFAULTS.MODEL;
    const customModelRaw = customModel.value.trim();
    const showSubtitlesValue = showSubtitlesToggle ? showSubtitlesToggle.checked : DEFAULTS.SHOW_SUBTITLES;

    const settings = {
      [STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]: scrapeApiKey.value.trim(),
      [STORAGE_KEYS.OPENROUTER_API_KEY]: openrouterApiKey.value.trim(),
      [STORAGE_KEYS.RECOMMENDED_MODEL]: selectedModel,
      [STORAGE_KEYS.CUSTOM_MODEL]: customModelRaw,
      [STORAGE_KEYS.AUTO_GENERATE]: autoGenerateToggle.checked,
      [STORAGE_KEYS.SHOW_SUBTITLES]: showSubtitlesValue,
    };

    chrome.storage.local.set(settings, function () {
      settingsStatus.textContent = "Settings saved successfully!";
      settingsStatus.className = "status success";

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const currentTab = tabs[0];
        if (
          currentTab &&
          typeof settings[STORAGE_KEYS.SHOW_SUBTITLES] === "boolean" &&
          currentTab.url &&
          currentTab.url.includes("youtube.com")
        ) {
          const enabled = settings[STORAGE_KEYS.SHOW_SUBTITLES];
          chrome.tabs.sendMessage(
            currentTab.id,
            {
              action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
              showSubtitles: enabled,
              enabled: enabled,
            },
            () => {
              if (chrome.runtime.lastError) {
                console.debug(
                  "Popup: Unable to forward toggle to content script:",
                  chrome.runtime.lastError.message
                );
              }
            }
          );
        }
      });

      setTimeout(() => {
        settingsStatus.textContent = "";
        settingsStatus.className = "status";
      }, 3000);
    });
  });

  // Load Current Video Info
  function loadCurrentVideo() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const currentTab = tabs[0];

      if (currentTab && currentTab.url && currentTab.url.includes("youtube.com/watch")) {
        currentVideoId = extractVideoId(currentTab.url);
        
        // Get video title from tab
        chrome.tabs.sendMessage(
          currentTab.id,
          { action: "GET_VIDEO_TITLE" },
          function (response) {
            if (response && response.title) {
              currentVideoTitle = sanitizeTitle(response.title);
              videoTitle.textContent = currentVideoTitle || "No video loaded";
            } else {
              currentVideoTitle = sanitizeTitle(currentTab.title) || "";
              videoTitle.textContent = currentVideoTitle || "No video loaded";
            }
          }
        );

        // Check if summary already exists
        if (currentVideoId) {
          chrome.storage.local.get([`summary_${currentVideoId}`], function (result) {
            if (result[`summary_${currentVideoId}`]) {
              displaySummary(result[`summary_${currentVideoId}`]);
            }
          });
        }
      } else {
        videoTitle.textContent = "Not on a YouTube video page";
        generateBtn.disabled = true;
      }
    });
  }

  // Display Summary
  function displaySummary(summaryText) {
    summaryContent.innerHTML = convertMarkdownToHTML(summaryText);
  }

  // Simple Markdown to HTML Converter
  function convertMarkdownToHTML(markdown) {
    let html = markdown;

    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^# (.*$)/gim, "<h3>$1</h3>");

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/gim, "<strong>$1</strong>");

    // Lists
    const lines = html.split("\n");
    let inList = false;
    let result = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.match(/^[\*\-•]\s/)) {
        if (!inList) {
          result.push("<ul>");
          inList = true;
        }
        result.push("<li>" + line.replace(/^[\*\-•]\s/, "") + "</li>");
      } else {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        result.push(line);
      }
    }

    if (inList) {
      result.push("</ul>");
    }

    html = result.join("\n");

    // Line breaks
    html = html.replace(/\n\n/g, "</p><p>");
    html = "<p>" + html + "</p>";

    return html;
  }

  // Generate Summary
  generateBtn.addEventListener("click", function () {
    if (generateBtn.disabled) return;

    status.textContent = "";
    status.className = "status";

    // Get settings
    chrome.storage.local.get(
      [
        STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
        STORAGE_KEYS.OPENROUTER_API_KEY,
        STORAGE_KEYS.RECOMMENDED_MODEL,
        STORAGE_KEYS.CUSTOM_MODEL,
      ],
      function (result) {
        const scrapeKey = result[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
        const openrouterKey = result[STORAGE_KEYS.OPENROUTER_API_KEY];

        if (!scrapeKey) {
          status.textContent = "Please enter Scrape Creators API key in Settings";
          status.className = "status error";
          showSettingsView();
          return;
        }

        if (!openrouterKey) {
          status.textContent = "Please enter OpenRouter API key in Settings";
          status.className = "status error";
          showSettingsView();
          return;
        }

        const customModelValue = result[STORAGE_KEYS.CUSTOM_MODEL]?.trim();
        const storedRecommendedValue = result[STORAGE_KEYS.RECOMMENDED_MODEL]?.trim();
        const uiRecommendedValue = recommendedModel && recommendedModel.value ? recommendedModel.value.trim() : "";
        const modelSelection =
          customModelValue ||
          storedRecommendedValue ||
          uiRecommendedValue ||
          DEFAULTS.MODEL;

        console.log("Popup: Generate Summary using model:", modelSelection);

        // Show loading state
        status.textContent = "Generating summary...";
        generateBtn.disabled = true;
        summaryContent.innerHTML = '<div class="summary-placeholder">Generating summary, please wait...</div>';

        // Get current tab
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          const currentTab = tabs[0];

          if (!currentTab || !currentTab.url || !currentTab.url.includes("youtube.com/watch")) {
            status.textContent = "Not a YouTube video page";
            status.className = "status error";
            generateBtn.disabled = false;
            return;
          }

          const videoId = extractVideoId(currentTab.url);

          if (!videoId) {
            status.textContent = "Could not extract video ID";
            status.className = "status error";
            generateBtn.disabled = false;
            return;
          }

          // Send message to content script
          chrome.tabs.sendMessage(
            currentTab.id,
            {
              action: MESSAGE_ACTIONS.GENERATE_SUMMARY,
              videoId: videoId,
              scrapeCreatorsApiKey: scrapeKey,
              openRouterApiKey: openrouterKey,
              modelSelection: modelSelection,
            },
            function (response) {
              if (chrome.runtime.lastError) {
                status.textContent = "Error: " + chrome.runtime.lastError.message;
                status.className = "status error";
                generateBtn.disabled = false;
                summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
              } else if (response && response.status === "started") {
                status.textContent = "Processing video transcript...";
              } else if (response && response.status === "error") {
                status.textContent = "Error: " + (response.message || "Unknown error");
                status.className = "status error";
                generateBtn.disabled = false;
                summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
              }
            }
          );
        });
      }
    );
  });

  // Listen for messages from background/content script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.SHOW_ERROR) {
      // Display error message
      status.textContent = `Error: ${message.error}`;
      status.className = "status error";
      
      // Show error notification
      if (message.error.includes("is not a valid model ID")) {
        alert(`Model Error: ${message.error}\n\nPlease check your model selection in Settings and ensure it's a valid OpenRouter model ID.`);
      }
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      status.textContent = message.text;
      
      if (message.error) {
        status.className = "status error";
        generateBtn.disabled = false;
        summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
      } else if (message.success) {
        status.className = "status success";
        generateBtn.disabled = false;
      }
    } else if (message.action === "SUMMARY_GENERATED") {
      if (message.summary) {
        displaySummary(message.summary);
        status.textContent = "Summary generated successfully!";
        status.className = "status success";
        
        // Save summary to storage
        if (currentVideoId) {
          chrome.storage.local.set({
            [`summary_${currentVideoId}`]: message.summary
          });
        }
        
        setTimeout(() => {
          status.textContent = "";
          status.className = "status";
        }, 3000);
      }
      generateBtn.disabled = false;
    }
  });

  // Initialize
  populateModelOptions();
  loadSettings();
  loadCurrentVideo();
});
