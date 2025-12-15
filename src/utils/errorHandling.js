/**
 * Error Handling Utilities
 * Centralized error extraction and formatting
 */

/**
 * Extract and format error message from various error types
 * @param {Error|Object|string} error - Error object
 * @returns {string} Formatted error message
 */
export function extractErrorMessage(error) {
  if (error instanceof Error) {
    const msg = error.message || "Unknown error";
    // Extract cleaner message for OpenRouter API errors
    const match = msg.match(/OpenRouter API error: (.+)/);
    return match ? match[1] : msg;
  }

  if (typeof error === "object" && error !== null) {
    if (error.message) return String(error.message);
    return JSON.stringify(error);
  }

  return String(error);
}

/**
 * Check if error is related to extension context invalidation
 * @param {Error|Object|string} error - Error to check
 * @returns {boolean} True if context invalidated error
 */
export function isContextInvalidatedError(error) {
  const msg = extractErrorMessage(error).toLowerCase();
  return msg.includes("extension context invalidated");
}

/**
 * Safely convert error to string and lowercase
 * @param {*} error - Error (can be string, object, array, etc.)
 * @returns {string} Lowercased error string
 */
export function errorToString(error) {
  if (typeof error === "string") {
    return error.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === "object" && error !== null) {
    if (error.message) {
      return String(error.message).toLowerCase();
    }
    if (error.error) {
      return errorToString(error.error);
    }
    return JSON.stringify(error).toLowerCase();
  }
  return String(error).toLowerCase();
}

/**
 * Check if error is a model-related error
 * @param {*} error - Error message (can be string, object, etc.)
 * @returns {boolean} True if model error
 */
export function isModelError(error) {
  const lowerError = errorToString(error);
  return (
    lowerError.includes("invalid model") ||
    lowerError.includes("not a valid model id") ||
    lowerError.includes("model not found") ||
    lowerError.includes("openrouter")
  );
}

