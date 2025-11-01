// Constants for YouTube Subtitles Generator Extension

// Storage keys
const STORAGE_KEYS = {
  SCRAPE_CREATORS_API_KEY: "scrapeCreatorsApiKey",
  OPENROUTER_API_KEY: "openRouterApiKey",
  MODEL_SELECTION: "modelSelection",
  AUTO_GENERATE: "autoGenerate",
};

// Timing constants
const TIMING = {
  AUTO_GENERATION_DELAY_MS: 2500, // 2.5 seconds delay before auto-generation
  INIT_RETRY_DELAY_MS: 500, // Delay between initialization retries
  SUBTITLE_UPDATE_INTERVAL_MS: 100, // How often to update subtitle display
  MAX_INIT_ATTEMPTS: 10, // Maximum retry attempts for finding video elements
};

// Storage constants
const STORAGE = {
  QUOTA_BYTES: 10 * 1024 * 1024, // 10MB Chrome storage limit
  MAX_STORAGE_BYTES: 9 * 1024 * 1024, // 9MB - leave 1MB buffer
  ESTIMATED_VIDEO_SIZE_BYTES: 30 * 1024, // Estimated ~30KB per video transcript
  CLEANUP_BATCH_SIZE: 10, // Number of videos to remove during cleanup
};

// Default values
const DEFAULTS = {
  MODEL: "google/gemini-2.5-flash-lite",
  AUTO_GENERATE: false,
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
  SUBTITLES_GENERATED: "subtitlesGenerated",
  UPDATE_POPUP_STATUS: "updatePopupStatus",
};

// Element IDs
const ELEMENT_IDS = {
  SUBTITLE_CONTAINER: "youtube-gemini-subtitles-container",
  SUBTITLE_TEXT: "youtube-gemini-subtitles-text",
};

