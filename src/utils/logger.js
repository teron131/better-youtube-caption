/**
 * Lightweight logger shared by content/popup/background.
 * Prefixes logs and can be toggled via DEBUG flag.
 * Works in both module and non-module contexts by attaching to globalThis.
 */
(function attachLogger(global) {
  const PREFIX = 'Better YouTube Caption:';
  let DEBUG = true;

  const log = (...args) => {
    if (!DEBUG) return;
    console.log(PREFIX, ...args);
  };

  const info = (...args) => {
    if (!DEBUG) return;
    console.info(PREFIX, ...args);
  };

  const warn = (...args) => {
    if (!DEBUG) return;
    console.warn(PREFIX, ...args);
  };

  const error = (...args) => {
    console.error(PREFIX, ...args);
  };

  const setDebug = (enabled) => {
    DEBUG = !!enabled;
  };

  const api = { log, info, warn, error, setDebug, get debugEnabled() { return DEBUG; } };

  // Attach to global for non-module consumers
  global.BYC_LOGGER = api;

  // Export for modules (if supported)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
