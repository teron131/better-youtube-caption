/**
 * Model Selection Utilities
 * Centralized logic for selecting models with priority: custom > recommended > default
 */

import { DEFAULTS, STORAGE_KEYS } from "../constants.js";
import { getApiKeyFromStorage } from "../storage.js";

/**
 * Get model selection with fallback priority
 * @param {string} messageModelSelection - Model from message (highest priority)
 * @param {string} customModel - Custom model from storage
 * @param {string} recommendedModel - Recommended model from storage
 * @param {string} defaultModel - Default model
 * @returns {string} Selected model
 */
export function getModelSelection(messageModelSelection, customModel, recommendedModel, defaultModel) {
  return (
    messageModelSelection ||
    (customModel?.trim() ? customModel.trim() : "") ||
    (recommendedModel?.trim() ? recommendedModel.trim() : "") ||
    defaultModel
  );
}

/**
 * Get summarizer model from storage
 * @param {Object} storageResult - Storage result object
 * @returns {Promise<string>} Selected model
 */
export async function getSummarizerModelFromStorage(storageResult = null) {
  if (storageResult) {
    const customModel = storageResult[STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL]?.trim();
    const recommendedModel = storageResult[STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL]?.trim();
    return customModel || recommendedModel || DEFAULTS.MODEL_SUMMARIZER;
  }

  const customModel = await getApiKeyFromStorage(STORAGE_KEYS.SUMMARIZER_CUSTOM_MODEL);
  const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.SUMMARIZER_RECOMMENDED_MODEL);
  return getModelSelection(null, customModel, recommendedModel, DEFAULTS.MODEL_SUMMARIZER);
}

/**
 * Get refiner model from storage
 * @param {Object} storageResult - Storage result object
 * @returns {Promise<string>} Selected model
 */
export async function getRefinerModelFromStorage(storageResult = null) {
  if (storageResult) {
    const customModel = storageResult[STORAGE_KEYS.REFINER_CUSTOM_MODEL]?.trim();
    const recommendedModel = storageResult[STORAGE_KEYS.REFINER_RECOMMENDED_MODEL]?.trim();
    return customModel || recommendedModel || DEFAULTS.MODEL_REFINER;
  }

  const customModel = await getApiKeyFromStorage(STORAGE_KEYS.REFINER_CUSTOM_MODEL);
  const recommendedModel = await getApiKeyFromStorage(STORAGE_KEYS.REFINER_RECOMMENDED_MODEL);
  return getModelSelection(null, customModel, recommendedModel, DEFAULTS.MODEL_REFINER);
}

/**
 * Get target language from storage
 * @param {Object} storageResult - Storage result object
 * @returns {Promise<string>} Selected target language
 */
export async function getTargetLanguageFromStorage(storageResult = null) {
  if (storageResult) {
    const customLanguage = storageResult[STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM]?.trim();
    const recommendedLanguage = storageResult[STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED]?.trim();
    return customLanguage || recommendedLanguage || DEFAULTS.TARGET_LANGUAGE_RECOMMENDED;
  }

  const customLanguage = await getApiKeyFromStorage(STORAGE_KEYS.TARGET_LANGUAGE_CUSTOM);
  const recommendedLanguage = await getApiKeyFromStorage(STORAGE_KEYS.TARGET_LANGUAGE_RECOMMENDED);
  return getModelSelection(null, customLanguage, recommendedLanguage, DEFAULTS.TARGET_LANGUAGE_RECOMMENDED);
}

