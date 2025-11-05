/**
 * Message Handler for Popup
 * Handles messages from background and content scripts
 */

/**
 * Handle model error by clearing invalid custom models
 * @param {Object} elements - DOM elements
 * @param {string} errorMessage - Error message
 */
function handleModelError(elements, errorMessage) {
  const clears = {};
  let clearedCount = 0;

  if (elements.summarizerCustomModel && elements.summarizerCustomModel.value.trim()) {
    elements.summarizerCustomModel.value = '';
    clears[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL] = '';
    clearedCount++;
  }

  if (elements.refinerCustomModel && elements.refinerCustomModel.value.trim()) {
    elements.refinerCustomModel.value = '';
    clears[STORAGE_KEYS.REFINER_CUSTOM_MODEL] = '';
    clearedCount++;
  }

  if (Object.keys(clears).length > 0) {
    chrome.storage.local.set(clears, () => {
      console.log('Popup: Cleared invalid custom models');
    });
    
    alert(
      `Model Error: ${errorMessage}\n\n` +
      `Invalid custom model input detected and cleared. ` +
      `Now using recommended models for summarizer and refiner. ` +
      `Please check your custom model entries if needed.`
    );
  } else {
    alert(
      `Model Error: ${errorMessage}\n\n` +
      `Please check your model selection in Settings and ensure it's a valid OpenRouter model ID.`
    );
  }
}

/**
 * Check if error is a model-related error
 * @param {string} error - Error message
 * @returns {boolean} True if model error
 */
function isModelError(error) {
  const lowerError = error.toLowerCase();
  return (
    lowerError.includes('invalid model') ||
    lowerError.includes('not a valid model id') ||
    lowerError.includes('model not found') ||
    lowerError.includes('openrouter')
  );
}

/**
 * Setup message listener for popup
 * @param {Object} elements - DOM elements
 */
function setupMessageListener(elements) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === MESSAGE_ACTIONS.SHOW_ERROR) {
      elements.status.className = 'status error';
      
      const error = message.error.toLowerCase();
      const isModel = isModelError(error);
      
      if (isModel && (elements.summarizerCustomModel || elements.refinerCustomModel)) {
        handleModelError(elements, message.error);
      } else if (isModel) {
        alert(
          `Model Error: ${message.error}\n\n` +
          `Please check your model selection in Settings and ensure it's a valid OpenRouter model ID.`
        );
      } else {
        elements.status.textContent = `Error: ${message.error}`;
      }
    } else if (message.action === MESSAGE_ACTIONS.UPDATE_POPUP_STATUS) {
      if (message.error) {
        elements.status.className = 'status error';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
        elements.summaryContent.innerHTML = '<div class="summary-placeholder">Failed to generate summary. Please try again.</div>';
        
        const error = message.error.toLowerCase();
        const isModel = isModelError(error);
        
        if (isModel && (elements.summarizerCustomModel || elements.refinerCustomModel)) {
          handleModelError(elements, message.error);
        } else {
          elements.status.textContent = message.text || `Error: ${message.error}`;
        }
      } else if (message.success) {
        elements.status.className = 'status success';
        elements.generateSummaryBtn.disabled = false;
        elements.generateCaptionBtn.disabled = false;
      } else {
        elements.status.textContent = message.text;
      }
    } else if (message.action === 'SUMMARY_GENERATED') {
      if (message.summary) {
        displaySummary(message.summary, elements.summaryContent);
        elements.status.textContent = 'Summary generated successfully!';
        elements.status.className = 'status success';
        
        // Note: Summary is already saved by background script, no need to save again here
        
        setTimeout(() => {
          elements.status.textContent = '';
          elements.status.className = 'status';
        }, 3000);
      }
      elements.generateSummaryBtn.disabled = false;
      elements.generateCaptionBtn.disabled = false;
    }
  });
}

/**
 * Display summary in the UI
 * @param {string} summaryText - Summary text (markdown)
 * @param {HTMLElement} summaryElement - Summary content element
 */
function displaySummary(summaryText, summaryElement) {
  summaryElement.innerHTML = convertMarkdownToHTML(summaryText);
}

