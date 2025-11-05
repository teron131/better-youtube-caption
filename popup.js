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
  const summarizerRecommendedModel = document.getElementById("summarizerRecommendedModel");
  const refinerRecommendedModel = document.getElementById("refinerRecommendedModel");
  const summarizerCustomModel = document.getElementById("summarizerCustomModel");
  const refinerCustomModel = document.getElementById("refinerCustomModel");
  const autoGenerateToggle = document.getElementById("autoGenerateToggle");
  const showSubtitlesToggle = document.getElementById("showSubtitlesToggle");

  function getModelLabel(value, list = RECOMMENDED_MODELS) {
    if (!Array.isArray(list)) {
      return value;
    }

    const match = list.find((model) => model.value === value);
    return match ? match.label : value;
  }

  function populateModelOptions() {
    // Populate summarizer
    if (summarizerRecommendedModel) {
      summarizerRecommendedModel.innerHTML = '<option value="" disabled selected hidden>Select a model</option>';

      if (Array.isArray(RECOMMENDED_SUMMARIZER_MODELS) && RECOMMENDED_SUMMARIZER_MODELS.length > 0) {
        RECOMMENDED_SUMMARIZER_MODELS.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.value;
          option.textContent = model.label || model.value;
          summarizerRecommendedModel.appendChild(option);
        });
      }

      if (DEFAULTS && DEFAULTS.MODEL_SUMMARIZER) {
        const defaultOption = document.createElement("option");
        defaultOption.value = DEFAULTS.MODEL_SUMMARIZER;
        defaultOption.textContent = getModelLabel(DEFAULTS.MODEL_SUMMARIZER, RECOMMENDED_SUMMARIZER_MODELS);
        if (!Array.from(summarizerRecommendedModel.options).some(opt => opt.value === DEFAULTS.MODEL_SUMMARIZER)) {
          summarizerRecommendedModel.appendChild(defaultOption);
        }
      }
    }

    // Populate refiner
    if (refinerRecommendedModel) {
      refinerRecommendedModel.innerHTML = '<option value="" disabled selected hidden>Select a model</option>';

      if (Array.isArray(RECOMMENDED_REFINER_MODELS) && RECOMMENDED_REFINER_MODELS.length > 0) {
        RECOMMENDED_REFINER_MODELS.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.value;
          option.textContent = model.label || model.value;
          refinerRecommendedModel.appendChild(option);
        });
      }

      if (DEFAULTS && DEFAULTS.MODEL_REFINER) {
        const defaultOption = document.createElement("option");
        defaultOption.value = DEFAULTS.MODEL_REFINER;
        defaultOption.textContent = getModelLabel(DEFAULTS.MODEL_REFINER, RECOMMENDED_REFINER_MODELS);
        if (!Array.from(refinerRecommendedModel.options).some(opt => opt.value === DEFAULTS.MODEL_REFINER)) {
          refinerRecommendedModel.appendChild(defaultOption);
        }
      }
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
        // Send message to content script to toggle subtitles (only on video pages)
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes("youtube.com/watch")) {
            chrome.tabs.sendMessage(
              currentTab.id,
              {
                action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
                showSubtitles: enabled,
                enabled: enabled,
              },
              () => {
                if (chrome.runtime.lastError) {
                  // Silently handle - content script might not be ready yet
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

  // Load Settings - update
  function loadSettings() {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
        STORAGE_KEYS.OPENROUTER_API_KEY,
        STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
        STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL,
        STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
        STORAGE_KEYS.REFINER_CUSTOM_MODEL,
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

        // Summarizer
        let summarizerRec = result[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL];
        if (summarizerRecommendedModel) {
          summarizerRecommendedModel.value = summarizerRec || DEFAULTS.MODEL_SUMMARIZER;
        }

        if (result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]) {
          const trimmed = result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL].trim();
          summarizerCustomModel.value = trimmed || '';
        }

        if (result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]) {
          const trimmed = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL].trim();
          refinerCustomModel.value = trimmed || '';
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

  // Save Settings - update
  saveBtn.addEventListener("click", function () {
    const showSubtitlesValue = showSubtitlesToggle ? showSubtitlesToggle.checked : DEFAULTS.SHOW_SUBTITLES;

    const settings = {
      [STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]: scrapeApiKey.value.trim(),
      [STORAGE_KEYS.OPENROUTER_API_KEY]: openrouterApiKey.value.trim(),
      [STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL]: summarizerRecommendedModel ? summarizerRecommendedModel.value.trim() : DEFAULTS.MODEL_SUMMARIZER,
      [STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]: summarizerCustomModel ? summarizerCustomModel.value.trim() || '' : '',
      [STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]: refinerRecommendedModel ? refinerRecommendedModel.value.trim() : DEFAULTS.MODEL_REFINER,
      [STORAGE_KEYS.REFINER_CUSTOM_MODEL]: refinerCustomModel ? refinerCustomModel.value.trim() || '' : '',
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
          currentTab.url.includes("youtube.com/watch")
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
                // Silently handle - content script might not be ready yet
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
            // Silently handle connection errors (content script might not be ready)
            if (chrome.runtime.lastError) {
              // Fallback to tab title
              currentVideoTitle = sanitizeTitle(currentTab.title) || "";
              videoTitle.textContent = currentVideoTitle || "No video loaded";
              return;
            }
            
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

  // Enhanced Markdown to HTML Converter
  function convertMarkdownToHTML(markdown) {
    if (!markdown || typeof markdown !== "string") {
      return '<div class="summary-placeholder">No summary available</div>';
    }

    const lines = markdown.split("\n");
    const result = [];
    let inList = false;
    let inParagraph = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        if (inParagraph) {
          result.push("</p>");
          inParagraph = false;
        }
        continue;
      }

      // Headers (## for h2, ### for h3, # for h1)
      if (line.match(/^###\s+(.+)$/)) {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        if (inParagraph) {
          result.push("</p>");
          inParagraph = false;
        }
        const headerText = line.replace(/^###\s+/, "");
        result.push(`<h3>${escapeHTML(headerText)}</h3>`);
      } else if (line.match(/^##\s+(.+)$/)) {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        if (inParagraph) {
          result.push("</p>");
          inParagraph = false;
        }
        const headerText = line.replace(/^##\s+/, "");
        result.push(`<h2>${escapeHTML(headerText)}</h2>`);
      } else if (line.match(/^#\s+(.+)$/)) {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        if (inParagraph) {
          result.push("</p>");
          inParagraph = false;
        }
        const headerText = line.replace(/^#\s+/, "");
        result.push(`<h2>${escapeHTML(headerText)}</h2>`);
      }
      // Bullet lists (supports -, *, •)
      else if (line.match(/^[\*\-•]\s+(.+)$/)) {
        if (inParagraph) {
          result.push("</p>");
          inParagraph = false;
        }
        if (!inList) {
          result.push("<ul>");
          inList = true;
        }
        const listItemText = line.replace(/^[\*\-•]\s+/, "");
        result.push(`<li>${formatInlineMarkdown(listItemText)}</li>`);
      }
      // Regular paragraph text
      else {
        if (inList) {
          result.push("</ul>");
          inList = false;
        }
        if (!inParagraph) {
          result.push("<p>");
          inParagraph = true;
        } else {
          result.push("<br>");
        }
        result.push(formatInlineMarkdown(line));
      }
    }

    // Close any open tags
    if (inList) {
      result.push("</ul>");
    }
    if (inParagraph) {
      result.push("</p>");
    }

    return result.join("");
  }

  // Format inline markdown (bold, italic, etc.)
  function formatInlineMarkdown(text) {
    // Process markdown patterns before escaping to avoid double-escaping
    // Since this text comes from our workflow (not direct user input), it's relatively safe
    
    // Bold (**text** or __text__) - process first
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
    
    // Italic (*text* or _text_) - only match if not part of bold
    // Simple approach: match single asterisk/underscore that's not doubled
    text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
    text = text.replace(/(?<!_)_([^_]+?)_(?!_)/g, "<em>$1</em>");
    
    // Code (`text`)
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    
    // Now escape any remaining HTML (but preserve our tags)
    // Split by our HTML tags, escape non-tag parts, then rejoin
    const parts = text.split(/(<[^>]+>)/g);
    const result = parts.map((part, index) => {
      // Odd indices are our HTML tags, keep them as-is
      if (index % 2 === 1) {
        return part;
      }
      // Even indices are text content, escape it
      return escapeHTML(part);
    });
    
    return result.join("");
  }

  // Escape HTML to prevent XSS
  function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Generate Summary - update
  generateBtn.addEventListener("click", function () {
    if (generateBtn.disabled) return;

    status.textContent = "";
    status.className = "status";

    // Get settings
    chrome.storage.local.get(
      [
        STORAGE_KEYS.SCRAPE_CREATORS_API_KEY,
        STORAGE_KEYS.OPENROUTER_API_KEY,
        STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL,
        STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL,
        STORAGE_KEYS.REFINER_RECOMMENDED_MODEL,
        STORAGE_KEYS.REFINER_CUSTOM_MODEL,
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

        const summarizerCustomValue = result[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]?.trim();
        const summarizerRecommendedValue = result[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL]?.trim();
        const refinerCustomValue = result[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
        const refinerRecommendedValue = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]?.trim();

        const summarizerModel = summarizerCustomValue || summarizerRecommendedValue || DEFAULTS.MODEL_SUMMARIZER;
        const refinerModel = refinerCustomValue || refinerRecommendedValue || DEFAULTS.MODEL_REFINER;

        console.log("Popup: Generate Summary using summarizer:", summarizerModel, "refiner:", refinerModel);

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
              summarizerModel: summarizerModel,
              refinerModel: refinerModel,
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
      status.className = "status error";
      
      const error = message.error.toLowerCase();
      const isModelError = error.includes('invalid model') || error.includes('not a valid model id') || error.includes('model not found') || error.includes('openrouter');
      
      if (isModelError && (summarizerCustomModel || refinerCustomModel)) {
        // Clear custom models on validation failure
        const clears = {};
        let clearedCount = 0;
        if (summarizerCustomModel && summarizerCustomModel.value.trim()) {
          summarizerCustomModel.value = '';
          clears[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] = '';
          clearedCount++;
        }
        if (refinerCustomModel && refinerCustomModel.value.trim()) {
          refinerCustomModel.value = '';
          clears[STORAGE_KEYS.REFINER_CUSTOM_MODEL] = '';
          clearedCount++;
        }
        
        if (Object.keys(clears).length > 0) {
          chrome.storage.local.set(clears, () => {
            console.log('Popup: Cleared invalid custom models');
          });
          status.textContent = "Model name might be wrong. Invalid custom models cleared—now using recommended.";
        } else {
          status.textContent = "Model name might be wrong. Please check your settings.";
        }
        
        // Show alert with details
        alert(`Model Error: ${message.error}\n\nInvalid custom model input detected and cleared. Now using recommended models for summarizer and refiner. Please check your custom model entries if needed.`);
      } else if (isModelError) {
        status.textContent = "Model name might be wrong. Please check your settings.";
        alert(`Model Error: ${message.error}\n\nPlease check your model selection in Settings and ensure it's a valid OpenRouter model ID.`);
      } else {
        // Non-model errors: show full error
        status.textContent = `Error: ${message.error}`;
      }
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      if (message.error) {
        status.className = "status error";
        generateBtn.disabled = false;
        summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
        
        // Also check for model errors here
        const error = message.error.toLowerCase();
        const isModelError = error.includes('invalid model') || error.includes('not a valid model id') || error.includes('model not found') || error.includes('openrouter');
        
        if (isModelError && (summarizerCustomModel || refinerCustomModel)) {
          // Clear custom models (same logic as above)
          const clears = {};
          let clearedCount = 0;
          if (summarizerCustomModel && summarizerCustomModel.value.trim()) {
            summarizerCustomModel.value = '';
            clears[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] = '';
            clearedCount++;
          }
          if (refinerCustomModel && refinerCustomModel.value.trim()) {
            refinerCustomModel.value = '';
            clears[STORAGE_KEYS.REFINER_CUSTOM_MODEL] = '';
            clearedCount++;
          }
          
          if (Object.keys(clears).length > 0) {
            chrome.storage.local.set(clears, () => {
              console.log('Popup: Cleared invalid custom models');
            });
            status.textContent = "Model name might be wrong. Invalid custom models cleared—now using recommended.";
          } else {
            status.textContent = "Model name might be wrong. Please check your settings.";
          }
          
          // Optional alert for details (or keep silent since it's status update)
          // alert(`Model Error: ${message.error}\n\nPlease check your settings.`);
        } else if (isModelError) {
          status.textContent = "Model name might be wrong. Please check your settings.";
          // alert if needed
        } else {
          status.textContent = message.text || `Error: ${message.error}`;
        }
      } else if (message.success) {
        status.className = "status success";
        generateBtn.disabled = false;
      } else {
        status.textContent = message.text;
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
