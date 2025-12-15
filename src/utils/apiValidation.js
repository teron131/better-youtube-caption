/**
 * API Validation Utilities
 * Centralized API key validation and retrieval
 */

import { getConfig } from "../config.js";
import { STORAGE_KEYS } from "../constants.js";
import { getApiKeyFromStorage } from "../storage.js";

/**
 * Get API key with fallback to test config
 * @param {string} keyName - Key name (e.g., 'scrapeCreatorsApiKey', 'openRouterApiKey')
 * @returns {Promise<string>} API key
 */
export async function getApiKeyWithFallback(keyName) {
  const testConfig = getConfig();

  if (testConfig.useTestConfig && testConfig[keyName]) {
    console.log(`Using test config for ${keyName}`);
    return testConfig[keyName];
  }

  return await getApiKeyFromStorage(keyName);
}

/**
 * Validate API keys from storage result
 * @param {Object} storageResult - Storage result object
 * @returns {Object} Validation result with keys and isValid flag
 */
export function validateApiKeys(storageResult) {
  const scrapeKey = storageResult[STORAGE_KEYS.SCRAPE_CREATORS_API_KEY];
  const openRouterKey = storageResult[STORAGE_KEYS.OPENROUTER_API_KEY];

  return {
    scrapeCreatorsKey: scrapeKey || null,
    openRouterKey: openRouterKey || null,
    isValid: !!(scrapeKey && openRouterKey),
    missingKeys: [
      !scrapeKey && "Scrape Creators API key",
      !openRouterKey && "OpenRouter API key",
    ].filter(Boolean),
  };
}

/**
 * Get API keys with fallback priority: message > storage > test config
 * @param {string} messageScrapeKey - Scrape Creators key from message
 * @param {string} messageOpenRouterKey - OpenRouter key from message
 * @returns {Promise<Object>} Object with scrapeCreatorsKey and openRouterKey
 */
export async function getApiKeys(messageScrapeKey, messageOpenRouterKey) {
  const scrapeKey = messageScrapeKey || (await getApiKeyWithFallback("scrapeCreatorsApiKey"));
  const openRouterKey = messageOpenRouterKey || (await getApiKeyWithFallback("openRouterApiKey"));

  return {
    scrapeCreatorsKey: scrapeKey,
    openRouterKey: openRouterKey,
  };
}

