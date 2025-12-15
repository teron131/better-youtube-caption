/**
 * Error Handling Utilities
 * Centralized error extraction and formatting
 */

/**
 * Convert error to string message
 * @param {*} error - Error (can be Error, string, object, etc.)
 * @returns {string} Error message
 */
function errorToMessage(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    if (error.message) return String(error.message);
    if (error.error) return errorToMessage(error.error);
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Extract and format error message from various error types
 * @param {Error|Object|string} error - Error object
 * @returns {string} Formatted error message
 */
export function extractErrorMessage(error) {
  const msg = errorToMessage(error);
  // Extract cleaner message for OpenRouter API errors
  const match = msg.match(/OpenRouter API error: (.+)/);
  return match ? match[1] : msg;
}

/**
 * Check if error is related to extension context invalidation
 * @param {Error|Object|string} error - Error to check
 * @returns {boolean} True if context invalidated error
 */
export function isContextInvalidatedError(error) {
  return extractErrorMessage(error).toLowerCase().includes("extension context invalidated");
}

/**
 * Check if error is a model-related error
 * @param {*} error - Error message (can be string, object, etc.)
 * @returns {boolean} True if model error
 */
export function isModelError(error) {
  const lowerError = extractErrorMessage(error).toLowerCase();
  return (
    lowerError.includes("invalid model") ||
    lowerError.includes("not a valid model id") ||
    lowerError.includes("model not found") ||
    lowerError.includes("openrouter")
  );
}

