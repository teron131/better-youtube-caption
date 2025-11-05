document.addEventListener("DOMContentLoaded", function () {
  // DOM Elements
  const mainView = document.getElementById("mainView");
  const settingsView = document.getElementById("settingsView");
  const settingsBtn = document.getElementById("settingsBtn");
  const backBtn = document.getElementById("backBtn");
  const generateBtn = document.getElementById("generateBtn");
  const videoTitle = document.getElementById("videoTitle");
  const summaryContent = document.getElementById("summaryContent");
  const status = document.getElementById("status");

  // Ensure status is empty on load
  // settingsStatus.textContent = ''; // Removed
  // settingsStatus.className = "settings-header-status"; // Removed

  // Form inputs
  const scrapeApiKey = document.getElementById("scrapeApiKey");
  const openrouterApiKey = document.getElementById("openrouterApiKey");
  const summarizerRecommendedModel = document.getElementById("summarizerRecommendedModel");
  const refinerRecommendedModel = document.getElementById("refinerRecommendedModel");
  const summarizerCustomModel = document.getElementById("summarizerCustomModel");
  const refinerCustomModel = document.getElementById("refinerCustomModel");
  const autoGenerateToggle = document.getElementById("autoGenerateToggle");
  const showSubtitlesToggle = document.getElementById("showSubtitlesToggle");

  function getProviderIcon(provider) {
    const icons = {
      'anthropic': 'images/anthropic.svg',
      'google': 'images/google.svg',
      'openai': 'images/openai.svg',
      'x-ai': 'images/xai.svg',
    };
    return icons[provider] || '';
  }

  function createOptionElement(model, type) {
    const item = document.createElement('div');
    item.className = 'select-item';
    item.dataset.value = model.value;

    const icon = document.createElement('span');
    icon.className = 'item-icon';
    const provider = model.value.split('/')[0];
    const iconSrc = getProviderIcon(provider);
    if (iconSrc) {
      const img = document.createElement('img');
      img.src = iconSrc;
      img.alt = provider;
      img.width = 16;
      img.height = 16;
      icon.appendChild(img);
    }
    item.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = model.label || model.value;
    item.appendChild(label);

    return item;
  }

  function populateModelOptions() {
    const customSelects = document.querySelectorAll('.custom-select');
    customSelects.forEach(select => {
      const type = select.dataset.modelType;
      const itemsContainer = select.querySelector('.select-items');
      const hiddenInput = select.querySelector('input[type="hidden"]');
      const modelList = type === 'summarizer' ? RECOMMENDED_SUMMARIZER_MODELS : RECOMMENDED_REFINER_MODELS;
      const defaultModel = type === 'summarizer' ? DEFAULTS.MODEL_SUMMARIZER : DEFAULTS.MODEL_REFINER;

      itemsContainer.innerHTML = '';

      if (Array.isArray(modelList) && modelList.length > 0) {
        modelList.forEach(model => {
          const option = createOptionElement(model, type);
          itemsContainer.appendChild(option);
        });
      }

      // Add default if not in list
      if (defaultModel && !modelList.some(m => m.value === defaultModel)) {
        const defaultModelObj = { value: defaultModel, label: defaultModel };
        const defaultOption = createOptionElement(defaultModelObj, type);
        itemsContainer.appendChild(defaultOption);
      }
    });

    // Add event listeners for all custom selects
    customSelects.forEach(select => {
      const selected = select.querySelector('.select-selected');
      const items = select.querySelector('.select-items');
      const hiddenInput = select.querySelector('input[type="hidden"]');

      selected.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = select.classList.contains('open');
        document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.select-items.show').forEach(i => i.classList.remove('show'));
        if (!isOpen) {
          select.classList.add('open');
          items.classList.add('show');
        }
        const type = select.dataset.modelType;
        console.log('Dropdown clicked for type: ' + type);
      });

      items.addEventListener('click', (e) => {
        if (e.target.closest('.select-item')) {
          const item = e.target.closest('.select-item');
          const value = item.dataset.value;
          const labelText = item.querySelector('.item-label').textContent;
          const provider = value.split('/')[0];
          const iconSrc = getProviderIcon(provider);

          // Update selected
          const iconSpan = selected.querySelector('.select-icon');
          iconSpan.innerHTML = '';
          if (iconSrc) {
            const img = document.createElement('img');
            img.src = iconSrc;
            img.alt = provider;
            img.width = 16;
            img.height = 16;
            iconSpan.appendChild(img);
          }
          selected.querySelector('.select-label').textContent = labelText;
          select.classList.remove('open');
          items.classList.remove('show');

          // Update items
          items.querySelectorAll('.select-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');

          // Set hidden input
          hiddenInput.value = value;
          saveSetting(hiddenInput.id, value);
        }
      });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-select')) {
        document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.select-items.show').forEach(i => i.classList.remove('show'));
      }
    });
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

        // Refiner
        let refinerRec = result[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL];
        if (refinerRecommendedModel) {
          refinerRecommendedModel.value = refinerRec || DEFAULTS.MODEL_REFINER;
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

        // Set selected for summarizer
        const summarizerValue = summarizerRec || DEFAULTS.MODEL_SUMMARIZER;
        const summarizerHidden = document.getElementById('summarizerRecommendedModel');
        if (summarizerHidden) {
          summarizerHidden.value = summarizerValue;
        }
        const summarizerSelect = document.querySelector('[data-model-type="summarizer"]');
        if (summarizerSelect) {
          const items = summarizerSelect.querySelector('.select-items');
          if (items) {
            const matchingItem = items.querySelector(`[data-value="${summarizerValue}"]`);
            const selected = summarizerSelect.querySelector('.select-selected');
            if (selected) {
              const provider = summarizerValue.split('/')[0];
              const iconSrc = getProviderIcon(provider);
              const iconSpan = selected.querySelector('.select-icon');
              iconSpan.innerHTML = '';
              if (iconSrc) {
                const img = document.createElement('img');
                img.src = iconSrc;
                img.alt = provider;
                img.width = 16;
                img.height = 16;
                iconSpan.appendChild(img);
              }
              let labelText = summarizerValue.split('/')[1] || summarizerValue; // Fallback label
              if (matchingItem) {
                labelText = matchingItem.querySelector('.item-label').textContent;
                matchingItem.classList.add('selected');
                items.querySelectorAll('.select-item').forEach(i => {
                  if (i !== matchingItem) i.classList.remove('selected');
                });
              }
              selected.querySelector('.select-label').textContent = labelText;
            }
          }
        }

        // Similar for refiner
        const refinerValue = refinerRec || DEFAULTS.MODEL_REFINER;
        const refinerHidden = document.getElementById('refinerRecommendedModel');
        if (refinerHidden) {
          refinerHidden.value = refinerValue;
        }
        const refinerSelect = document.querySelector('[data-model-type="refiner"]');
        if (refinerSelect) {
          const items = refinerSelect.querySelector('.select-items');
          if (items) {
            const matchingItem = items.querySelector(`[data-value="${refinerValue}"]`);
            const selected = refinerSelect.querySelector('.select-selected');
            if (selected) {
              const provider = refinerValue.split('/')[0];
              const iconSrc = getProviderIcon(provider);
              const iconSpan = selected.querySelector('.select-icon');
              iconSpan.innerHTML = '';
              if (iconSrc) {
                const img = document.createElement('img');
                img.src = iconSrc;
                img.alt = provider;
                img.width = 16;
                img.height = 16;
                iconSpan.appendChild(img);
              }
              let labelText = refinerValue.split('/')[1] || refinerValue;
              if (matchingItem) {
                labelText = matchingItem.querySelector('.item-label').textContent;
                matchingItem.classList.add('selected');
                items.querySelectorAll('.select-item').forEach(i => {
                  if (i !== matchingItem) i.classList.remove('selected');
                });
              }
              selected.querySelector('.select-label').textContent = labelText;
            }
          }
        }
      }
    );
  }

  function saveSetting(key, value) {
    const settings = { [key]: value };
    chrome.storage.local.set(settings, function () {
      console.debug('Auto-saved:', key, value);
    });
  }

  // Add event listeners after loadSettings() in DOMContentLoaded
  // For API keys
  if (scrapeApiKey) {
    scrapeApiKey.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.SCRAPE_CREATORS_API_KEY, this.value.trim());
    });
  }

  if (openrouterApiKey) {
    openrouterApiKey.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.OPENROUTER_API_KEY, this.value.trim());
    });
  }

  // For custom models
  if (summarizerCustomModel) {
    summarizerCustomModel.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL, this.value.trim());
    });
  }

  if (refinerCustomModel) {
    refinerCustomModel.addEventListener('input', function() {
      saveSetting(STORAGE_KEYS.REFINER_CUSTOM_MODEL, this.value.trim());
    });
  }

  // For toggle - already has change, but update to use saveSetting
  if (autoGenerateToggle) {
    autoGenerateToggle.addEventListener('change', function() {
      saveSetting(STORAGE_KEYS.AUTO_GENERATE, this.checked);
    });
  }

  // For custom selects, update the click handler in populateModelOptions (around line 150-200 in items.addEventListener):
  // After hiddenInput.value = value;
  // saveSetting(hiddenInput.id, value); // This line was removed from the new_code, so it's removed here.

  // Save Settings - update
  // Removed: const showSubtitlesValue = showSubtitlesToggle ? showSubtitlesToggle.checked : DEFAULTS.SHOW_SUBTITLES;

  // Removed: const settings = {
  // Removed:   [STORAGE_KEYS.SCRAPE_CREATORS_API_KEY]: scrapeApiKey.value.trim(),
  // Removed:   [STORAGE_KEYS.OPENROUTER_API_KEY]: openrouterApiKey.value.trim(),
  // Removed:   [STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL]: document.getElementById('summarizerRecommendedModel').value.trim() || DEFAULTS.MODEL_SUMMARIZER,
  // Removed:   [STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]: summarizerCustomModel ? summarizerCustomModel.value.trim() || '' : '',
  // Removed:   [STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]: document.getElementById('refinerRecommendedModel').value.trim() || DEFAULTS.MODEL_REFINER,
  // Removed:   [STORAGE_KEYS.REFINER_CUSTOM_MODEL]: refinerCustomModel ? refinerCustomModel.value.trim() || '' : '',
  // Removed:   [STORAGE_KEYS.AUTO_GENERATE]: autoGenerateToggle.checked,
  // Removed:   [STORAGE_KEYS.SHOW_SUBTITLES]: showSubtitlesValue,
  // Removed: };

  // Removed: chrome.storage.local.set(settings, function () {
  // Removed:   settingsStatus.textContent = "Settings saved successfully!";
  // Removed:   settingsStatus.className = "settings-header-status success";

  // Removed:   chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  // Removed:     const currentTab = tabs[0];
  // Removed:     if (
  // Removed:       currentTab &&
  // Removed:       typeof settings[STORAGE_KEYS.SHOW_SUBTITLES] === "boolean" &&
  // Removed:       currentTab.url &&
  // Removed:       currentTab.url.includes("youtube.com/watch")
  // Removed:     ) {
  // Removed:       const enabled = settings[STORAGE_KEYS.SHOW_SUBTITLES];
  // Removed:       chrome.tabs.sendMessage(
  // Removed:         currentTab.id,
  // Removed:         {
  // Removed:           action: MESSAGE_ACTIONS.TOGGLE_SUBTITLES,
  // Removed:           showSubtitles: enabled,
  // Removed:           enabled: enabled,
  // Removed:         },
  // Removed:         () => {
  // Removed:           if (chrome.runtime.lastError) {
  // Removed:             // Silently handle - content script might not be ready yet
  // Removed:             console.debug(
  // Removed:               "Popup: Unable to forward toggle to content script:",
  // Removed:               chrome.runtime.lastError.message
  // Removed:             );
  // Removed:           }
  // Removed:         }
  // Removed:       );
  // Removed:     }
  // Removed:   });

  // Removed:   setTimeout(() => {
  // Removed:     settingsStatus.textContent = "";
  // Removed:     settingsStatus.className = "status";
  // Removed:   }, 3000);
  // Removed: });

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
          // settingsStatus.textContent = "Model name might be wrong. Invalid custom models cleared—now using recommended."; // Removed
          // settingsStatus.className = "settings-header-status error"; // Removed
        } else {
          // settingsStatus.textContent = "Model name might be wrong. Please check your settings."; // Removed
        }
        
        // Show alert with details
        alert(`Model Error: ${message.error}\n\nInvalid custom model input detected and cleared. Now using recommended models for summarizer and refiner. Please check your custom model entries if needed.`);
      } else if (isModelError) {
        // settingsStatus.textContent = "Model name might be wrong. Please check your settings."; // Removed
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
            // settingsStatus.textContent = "Model name might be wrong. Invalid custom models cleared—now using recommended."; // Removed
            // settingsStatus.className = "settings-header-status error"; // Removed
          } else {
            // settingsStatus.textContent = "Model name might be wrong. Please check your settings."; // Removed
          }
          
          // Optional alert for details (or keep silent since it's status update)
          // alert(`Model Error: ${message.error}\n\nPlease check your settings.`);
        } else if (isModelError) {
          // settingsStatus.textContent = "Model name might be wrong. Please check your settings."; // Removed
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

  // Add tooltip delay functionality for easier URL copying
  const infoIcons = document.querySelectorAll('.info-icon');
  const iconTooltips = new Map(); // Track icon -> tooltip element
  
  infoIcons.forEach(icon => {
    // Wrap icon if not already wrapped
    let wrapper = icon.parentElement;
    if (!wrapper || !wrapper.classList.contains('info-icon-wrapper')) {
      wrapper = document.createElement('span');
      wrapper.className = 'info-icon-wrapper';
      icon.parentNode.insertBefore(wrapper, icon);
      wrapper.appendChild(icon);
    }
    
    // Create tooltip element and append to wrapper
    const tooltip = document.createElement('div');
    tooltip.className = 'info-tooltip';
    tooltip.textContent = icon.getAttribute('data-tooltip');
    wrapper.appendChild(tooltip);
    
    // Store reference
    iconTooltips.set(icon, { tooltip: tooltip, hideTimeout: null });

    icon.addEventListener('mouseenter', function() {
      const state = iconTooltips.get(this);
      if (!state) return;
      
      // Clear any pending hide timeout
      if (state.hideTimeout) {
        clearTimeout(state.hideTimeout);
        state.hideTimeout = null;
      }
      
      // Show tooltip
      state.tooltip.classList.remove('hide');
      state.tooltip.classList.add('show');
    });

    icon.addEventListener('mouseleave', function(e) {
      const state = iconTooltips.get(this);
      if (!state) return;
      
      // Start delay - will be cancelled if mouse enters tooltip
      state.hideTimeout = setTimeout(() => {
        state.tooltip.classList.remove('show');
        state.tooltip.classList.add('hide');
        state.hideTimeout = null;
      }, 2000);
    });

    // Keep tooltip visible when hovering over it
    tooltip.addEventListener('mouseenter', function() {
      const state = iconTooltips.get(icon);
      if (!state) return;
      
      if (state.hideTimeout) {
        clearTimeout(state.hideTimeout);
        state.hideTimeout = null;
      }
      tooltip.classList.remove('hide');
      tooltip.classList.add('show');
    });

    tooltip.addEventListener('mouseleave', function() {
      const state = iconTooltips.get(icon);
      if (!state) return;
      
      // Delay before hiding
      state.hideTimeout = setTimeout(() => {
        tooltip.classList.remove('show');
        tooltip.classList.add('hide');
        state.hideTimeout = null;
      }, 500);
    });
  });

  // Initialize
  populateModelOptions();
  loadSettings();
  loadCurrentVideo();
});
