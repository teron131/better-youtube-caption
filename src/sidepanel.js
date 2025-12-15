/**
 * Side Panel Script for Better YouTube Caption Extension
 * Main entry point for side panel UI
 */

import { TIMING } from "./constants.js";
import { getStoredSubtitles } from "./storage.js";
import { initializeComboboxes } from "./utils/combobox.js";
import { initializeFontSizeSelectors } from "./utils/fontSize.js";
import { checkRefinedCaptionsAvailability, generateCaptions, generateSummary } from "./utils/generation.js";
import { loadExistingSummary } from "./utils/loadSummary.js";
import { setupMessageListener } from "./utils/messageHandler.js";
import { loadSettings, setupSettingsListeners } from "./utils/sidepanelSettings.js";
import { initializeTooltips } from "./utils/tooltip.js";
import { getVideoIdFromCurrentTab } from "./utils/videoUtils.js";

document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const elements = {
    // Views
    mainView: document.getElementById('mainView'),
    settingsView: document.getElementById('settingsView'),
    
    // Buttons
    settingsBtn: document.getElementById('settingsBtn'),
    backBtn: document.getElementById('backBtn'),
    generateSummaryBtn: document.getElementById('generateSummaryBtn'),
    generateCaptionBtn: document.getElementById('generateCaptionBtn'),
    copyCaptionBtn: document.getElementById('copyCaptionBtn'),
    
    // Content
    summaryContent: document.getElementById('summaryContent'),
    status: document.getElementById('status'),
    
    // Form inputs
    scrapeApiKey: document.getElementById('scrapeApiKey'),
    openrouterApiKey: document.getElementById('openrouterApiKey'),
    summarizerInput: document.getElementById('summarizerInput'),
    refinerInput: document.getElementById('refinerInput'),
    autoGenerateToggle: document.getElementById('autoGenerateToggle'),
    showSubtitlesToggle: document.getElementById('showSubtitlesToggle'),
    targetLanguageInput: document.getElementById('targetLanguageInput'),
  };

  // View Management
  function showMainView() {
    elements.mainView.classList.add('active');
    elements.settingsView.classList.remove('active');
  }

  function showSettingsView() {
    elements.mainView.classList.remove('active');
    elements.settingsView.classList.add('active');
  }

  // Setup navigation
  if (elements.settingsBtn) {
    elements.settingsBtn.addEventListener('click', showSettingsView);
  }
  if (elements.backBtn) {
    elements.backBtn.addEventListener('click', showMainView);
  }

  /**
   * Copy refined caption to clipboard
   */
  async function copyRefinedCaption() {
    if (elements.copyCaptionBtn?.disabled) {
      return;
    }

    try {
      const videoId = await getVideoIdFromCurrentTab();
      if (!videoId) {
        elements.status.textContent = "Not a YouTube video page";
        elements.status.className = "status error";
        return;
      }

      const subtitles = await getStoredSubtitles(videoId);
      if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0) {
        elements.status.textContent = 'No refined captions available';
        elements.status.className = 'status error';
        return;
      }

      // Join all segment texts with spaces (replacing newlines)
      const captionText = subtitles
        .map((segment) => (segment.text || '').replace(/\n/g, ' ').trim())
        .filter((text) => text.length > 0)
        .join(' ');

      // Copy to clipboard
      await navigator.clipboard.writeText(captionText);
      
      // Show success message
      elements.status.textContent = 'Refined caption copied to clipboard!';
      elements.status.className = 'status success';
      
      setTimeout(() => {
        elements.status.textContent = "";
        elements.status.className = "status";
      }, TIMING.STATUS_MESSAGE_DISPLAY_MS);
    } catch (error) {
      console.error('Error copying refined caption:', error);
      elements.status.textContent = 'Failed to copy caption';
      elements.status.className = 'status error';
    }
  }

  // Initialize components
  initializeComboboxes();
  loadSettings(elements);
  setupSettingsListeners(elements);
  initializeFontSizeSelectors(elements);
  initializeTooltips();
  setupMessageListener(elements);
  loadExistingSummary(elements);
  checkRefinedCaptionsAvailability(elements.copyCaptionBtn);

  // Setup generation buttons
  if (elements.generateSummaryBtn) {
    elements.generateSummaryBtn.addEventListener('click', () => {
      generateSummary(elements, showSettingsView);
    });
  }

  if (elements.generateCaptionBtn) {
    elements.generateCaptionBtn.addEventListener('click', () => {
      generateCaptions(elements, showSettingsView);
    });
  }

  // Setup copy button
  if (elements.copyCaptionBtn) {
    elements.copyCaptionBtn.addEventListener('click', copyRefinedCaption);
  }

  // Handle tab context changes for Side Panel
  function updateContext() {
    // Clear status
    if (elements.status) {
      elements.status.textContent = '';
      elements.status.className = 'status';
    }

    // Reset summary to placeholder
    if (elements.summaryContent) {
       elements.summaryContent.innerHTML = '<div class="summary-placeholder">Click "Generate Summary" to create a summary for this video</div>';
    }
    
    // Re-check availability and summary
    checkRefinedCaptionsAvailability(elements.copyCaptionBtn);
    loadExistingSummary(elements);
  }

  // Update when active tab changes
  chrome.tabs.onActivated.addListener(updateContext);

  // Update when current tab URL changes
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
      updateContext();
    }
  });
});

