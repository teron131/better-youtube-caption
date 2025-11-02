/**
 * Configuration management utilities
 * Centralizes configuration values and provides validation
 */

/**
 * Timeout configurations (in milliseconds)
 */
const TIMEOUTS = {
  API_REQUEST: 30000,           // 30 seconds for regular API requests
  OPENROUTER_REQUEST: 120000,   // 2 minutes for LLM requests
  AUTO_GENERATION_DELAY: 3000,  // 3 seconds delay before auto-generation
  STATUS_MESSAGE_DISPLAY: 3000, // 3 seconds to display status messages
};

/**
 * Subtitle display configurations
 */
const SUBTITLE_CONFIG = {
  UPDATE_INTERVAL: 100,         // 100ms interval for subtitle updates
  FADE_DURATION: 300,           // 300ms fade animation
  MAX_LINES: 2,                 // Maximum lines to display
  FONT_SIZE_BASE: 24,           // Base font size in pixels
};

/**
 * Storage configurations
 */
const STORAGE_CONFIG = {
  MAX_ITEMS: 50,                // Maximum items in storage
  CLEANUP_THRESHOLD: 45,        // Cleanup when reaching this many items
  SUBTITLE_KEY_PREFIX: 'subtitles_',
  SUMMARY_KEY_PREFIX: 'summary_',
};

/**
 * API configurations
 */
const API_CONFIG = {
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,            // 1 second between retries
  MAX_TRANSCRIPT_LENGTH: 100000, // Maximum characters for transcript
};

/**
 * Get timeout value by key
 * @param {string} key - Timeout key
 * @returns {number} Timeout in milliseconds
 */
function getTimeout(key) {
  return TIMEOUTS[key] || TIMEOUTS.API_REQUEST;
}

/**
 * Get subtitle configuration
 * @returns {Object} Subtitle configuration object
 */
function getSubtitleConfig() {
  return { ...SUBTITLE_CONFIG };
}

/**
 * Get storage configuration
 * @returns {Object} Storage configuration object
 */
function getStorageConfig() {
  return { ...STORAGE_CONFIG };
}

/**
 * Get API configuration
 * @returns {Object} API configuration object
 */
function getApiConfig() {
  return { ...API_CONFIG };
}

/**
 * Validate configuration values
 * @returns {boolean} True if all configurations are valid
 */
function validateConfig() {
  // Check timeouts are positive numbers
  for (const [key, value] of Object.entries(TIMEOUTS)) {
    if (typeof value !== 'number' || value <= 0) {
      console.error(`Invalid timeout configuration: ${key} = ${value}`);
      return false;
    }
  }
  
  // Check subtitle config
  if (SUBTITLE_CONFIG.UPDATE_INTERVAL <= 0) {
    console.error('Invalid subtitle update interval');
    return false;
  }
  
  // Check storage config
  if (STORAGE_CONFIG.MAX_ITEMS <= 0 || STORAGE_CONFIG.CLEANUP_THRESHOLD <= 0) {
    console.error('Invalid storage configuration');
    return false;
  }
  
  return true;
}

