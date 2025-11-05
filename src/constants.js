// Constants for Better YouTube Caption Extension

// Storage keys
const STORAGE_KEYS = {
  SCRAPE_CREATORS_API_KEY: "scrapeCreatorsApiKey",
  OPENROUTER_API_KEY: "openRouterApiKey",
  SUMMARIZER_RECOMMENDED_MODEL: "summarizerRecommendedModel",
  SUMMARIZER_CUSTOM_MODEL: "summarizerCustomModel",
  REFINER_RECOMMENDED_MODEL: "refinerRecommendedModel",
  REFINER_CUSTOM_MODEL: "refinerCustomModel",
  AUTO_GENERATE: "autoGenerate",
  SHOW_SUBTITLES: "showSubtitles",
  CAPTION_FONT_SIZE: "captionFontSize",
  SUMMARY_FONT_SIZE: "summaryFontSize",
};

// Timing constants
const TIMING = {
  AUTO_GENERATION_DELAY_MS: 2000, // 2 seconds delay before auto-generation
  INIT_RETRY_DELAY_MS: 500, // Delay between initialization retries
  SUBTITLE_UPDATE_INTERVAL_MS: 100, // How often to update subtitle display
  MAX_INIT_ATTEMPTS: 5, // Maximum retry attempts for finding video elements
};

// Storage constants
const STORAGE = {
  QUOTA_BYTES: 10 * 1024 * 1024, // 10MB Chrome storage limit
  MAX_STORAGE_BYTES: 9.5 * 1024 * 1024, // 9.5MB - leave 0.5MB buffer
  ESTIMATED_VIDEO_SIZE_BYTES: 30 * 1024, // Estimated ~30KB per video transcript
  CLEANUP_BATCH_SIZE: 10, // Number of videos to remove during cleanup
};

// New separate lists for summarizer and refiner
const RECOMMENDED_SUMMARIZER_MODELS = [
  { value: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
  { value: "x-ai/grok-code-fast-1", label: "Grok Code Fast 1" },
  { value: "x-ai/grok-4", label: "Grok 4" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
];

const RECOMMENDED_REFINER_MODELS = [
  { value: "google/gemini-2.5-flash-lite-preview-09-2025", label: "Gemini 2.5 Flash Lite" },
  { value: "x-ai/grok-4-fast", label: "Grok 4 Fast" },
];

// Default values
const DEFAULTS = {
  MODEL_SUMMARIZER: "x-ai/grok-4-fast",
  MODEL_REFINER: "google/gemini-2.5-flash-lite-preview-09-2025",
  AUTO_GENERATE: false,
  SHOW_SUBTITLES: true, // Subtitles shown by default
  CAPTION_FONT_SIZE: "M", // Medium
  SUMMARY_FONT_SIZE: "M", // Medium
};

// Font size mappings
const FONT_SIZES = {
  CAPTION: {
    S: { base: "1.4vw", max: "22px", min: "12px", fullscreen: "1.7vw", fullscreenMax: "28px" },
    M: { base: "1.8vw", max: "28px", min: "14px", fullscreen: "2.2vw", fullscreenMax: "36px" },
    L: { base: "2.2vw", max: "34px", min: "16px", fullscreen: "2.7vw", fullscreenMax: "44px" },
  },
  SUMMARY: {
    S: { base: "13px", h2: "17px", h3: "15px" },
    M: { base: "15px", h2: "20px", h3: "17px" },
    L: { base: "17px", h2: "23px", h3: "19px" },
  },
};

// API endpoints
const API_ENDPOINTS = {
  SCRAPE_CREATORS: "https://api.scrapecreators.com/v1/youtube/video",
  OPENROUTER: "https://openrouter.ai/api/v1/chat/completions",
};

// YouTube-specific constants
const YOUTUBE = {
  VIDEO_ID_LENGTH: 11, // Standard YouTube video ID length
  SELECTORS: {
    VIDEO_PLAYER: "video.html5-main-video",
    MOVIE_PLAYER: "#movie_player",
    VIDEO_CONTAINER: ".html5-video-container",
  },
};

// Message actions
const MESSAGE_ACTIONS = {
  FETCH_SUBTITLES: "fetchSubtitles",
  GENERATE_SUBTITLES: "generateSubtitles",
  GENERATE_SUMMARY: "generateSummary",
  SUBTITLES_GENERATED: "subtitlesGenerated",
  SUMMARY_GENERATED: "summaryGenerated",
  UPDATE_POPUP_STATUS: "updatePopupStatus",
  TOGGLE_SUBTITLES: "toggleSubtitles",
  GET_VIDEO_TITLE: "getVideoTitle",
  SHOW_ERROR: "showError",
  UPDATE_CAPTION_FONT_SIZE: "updateCaptionFontSize",
};

// Element IDs
const ELEMENT_IDS = {
  SUBTITLE_CONTAINER: "youtube-gemini-subtitles-container",
  SUBTITLE_TEXT: "youtube-gemini-subtitles-text",
};

