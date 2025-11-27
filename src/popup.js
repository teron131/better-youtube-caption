/**
 * Popup Script for Better YouTube Caption Extension
 * Main entry point for popup UI
 */

import { getStoredSubtitles } from "./storage.js";
import { extractVideoId } from "./url.js";
import { initializeComboboxes } from "./utils/combobox.js";
import { initializeFontSizeSelectors } from "./utils/fontSize.js";
import { checkRefinedCaptionsAvailability, generateCaptions, generateSummary } from "./utils/generation.js";
import { loadExistingSummary } from "./utils/loadSummary.js";
import { setupMessageListener } from "./utils/messageHandler.js";
import { loadSettings, setupSettingsListeners } from "./utils/popupSettings.js";
import { initializeTooltips } from "./utils/tooltip.js";

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
      const currentTab = await new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          resolve(tabs[0]);
        });
      });

      if (!currentTab || !currentTab.url || !currentTab.url.includes('youtube.com/watch')) {
        elements.status.textContent = 'Not a YouTube video page';
        elements.status.className = 'status error';
        return;
      }

      const videoId = extractVideoId(currentTab.url);
      if (!videoId) {
        elements.status.textContent = 'Could not extract video ID';
        elements.status.className = 'status error';
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
        elements.status.textContent = '';
        elements.status.className = 'status';
      }, 2000);
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
});

