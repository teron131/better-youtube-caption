/**
 * Lightweight logger shared by content/popup/background.
 * Prefixes logs and can be toggled via DEBUG flag.
 */

const PREFIX = 'Better YouTube Caption:';
let DEBUG = true;

export const log = (...args) => {
  if (!DEBUG) return;
  console.log(PREFIX, ...args);
};

export const warn = (...args) => {
  if (!DEBUG) return;
  console.warn(PREFIX, ...args);
};

export const error = (...args) => {
  console.error(PREFIX, ...args);
};

export const setDebug = (enabled) => {
  DEBUG = !!enabled;
};
