/**
 * Font Size Management
 * Handles font size settings for captions and summary
 */
(function () {
  const logDebug = (typeof BYC_LOGGER !== 'undefined' && BYC_LOGGER?.log) || (() => {});

/**
 * Apply summary font size to summary content
 * @param {string} size - Size key (S, M, L)
 */
function applySummaryFontSize(size) {
  const sizeConfig = FONT_SIZES.SUMMARY[size] || FONT_SIZES.SUMMARY.M;
  const summaryContent = document.getElementById('summaryContent');
  
  if (summaryContent) {
    summaryContent.style.setProperty('--summary-font-size-base', sizeConfig.base);
    summaryContent.style.setProperty('--summary-font-size-h2', sizeConfig.h2);
    summaryContent.style.setProperty('--summary-font-size-h3', sizeConfig.h3);
  }
}

/**
 * Initialize font size selectors
 * @param {Object} elements - DOM elements
 */
function initializeFontSizeSelectors(elements) {
  // Load saved font sizes
  chrome.storage.local.get(
    [STORAGE_KEYS.CAPTION_FONT_SIZE, STORAGE_KEYS.SUMMARY_FONT_SIZE],
    (result) => {
      const captionSize = result[STORAGE_KEYS.CAPTION_FONT_SIZE] || DEFAULTS.CAPTION_FONT_SIZE;
      const summarySize = result[STORAGE_KEYS.SUMMARY_FONT_SIZE] || DEFAULTS.SUMMARY_FONT_SIZE;
      
      // Set active buttons
      document.querySelectorAll('.font-size-button[data-type="caption"]').forEach(btn => {
        if (btn.dataset.size === captionSize) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      document.querySelectorAll('.font-size-button[data-type="summary"]').forEach(btn => {
        if (btn.dataset.size === summarySize) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      // Apply font sizes
      applySummaryFontSize(summarySize);
    }
  );
  
  // Setup click handlers
  document.querySelectorAll('.font-size-button').forEach(button => {
    button.addEventListener('click', function() {
      const size = this.dataset.size;
      const type = this.dataset.type;
      
      // Update active state
      document.querySelectorAll(`.font-size-button[data-type="${type}"]`).forEach(btn => {
        btn.classList.remove('active');
      });
      this.classList.add('active');
      
      // Save setting
      const storageKey = type === 'caption' 
        ? STORAGE_KEYS.CAPTION_FONT_SIZE 
        : STORAGE_KEYS.SUMMARY_FONT_SIZE;
      saveSetting(storageKey, size);
      
      // Apply font size
      if (type === 'caption') {
        // Notify content script to update caption font size
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const currentTab = tabs[0];
          if (currentTab && currentTab.url && currentTab.url.includes('youtube.com/watch')) {
            chrome.tabs.sendMessage(currentTab.id, {
              action: MESSAGE_ACTIONS.UPDATE_CAPTION_FONT_SIZE,
              fontSize: size,
            }, () => {
              if (chrome.runtime.lastError) {
                logDebug('Popup: Unable to update caption font size:', chrome.runtime.lastError.message);
              }
            });
          }
        });
      } else {
        applySummaryFontSize(size);
      }
    });
  });
}

  // Expose to global
  window.initializeFontSizeSelectors = initializeFontSizeSelectors;
})();
