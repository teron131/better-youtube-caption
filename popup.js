/**
 * Popup Script for Better YouTube Caption Extension
 * Main entry point for popup UI
 */

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
    
    // Content
    summaryContent: document.getElementById('summaryContent'),
    status: document.getElementById('status'),
    
    // Form inputs
    scrapeApiKey: document.getElementById('scrapeApiKey'),
    openrouterApiKey: document.getElementById('openrouterApiKey'),
    summarizerRecommendedModel: document.getElementById('summarizerRecommendedModel'),
    refinerRecommendedModel: document.getElementById('refinerRecommendedModel'),
    summarizerCustomModel: document.getElementById('summarizerCustomModel'),
    refinerCustomModel: document.getElementById('refinerCustomModel'),
    autoGenerateToggle: document.getElementById('autoGenerateToggle'),
    showSubtitlesToggle: document.getElementById('showSubtitlesToggle'),
    targetLanguage: document.getElementById('targetLanguage'),
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

  // Initialize components
  initializeCustomSelects();
  loadSettings(elements);
  setupSettingsListeners(elements);
  initializeFontSizeSelectors(elements);
  initializeTooltips();
  setupMessageListener(elements);
  loadExistingSummary(elements);

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
});
