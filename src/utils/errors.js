/**
 * Custom error classes and error handling utilities
 * Provides consistent error handling across the extension
 */

/**
 * Base error class for extension errors
 */
class ExtensionError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * API-related errors
 */
class APIError extends ExtensionError {
  constructor(message, statusCode, apiName, details) {
    super(message, 'API_ERROR', details);
    this.statusCode = statusCode;
    this.apiName = apiName;
  }
}

/**
 * Storage-related errors
 */
class StorageError extends ExtensionError {
  constructor(message, details) {
    super(message, 'STORAGE_ERROR', details);
  }
}

/**
 * Validation errors
 */
class ValidationError extends ExtensionError {
  constructor(message, field, details) {
    super(message, 'VALIDATION_ERROR', details);
    this.field = field;
  }
}

/**
 * Timeout errors
 */
class TimeoutError extends ExtensionError {
  constructor(message, timeoutMs, details) {
    super(message, 'TIMEOUT_ERROR', details);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Extract user-friendly error message from any error
 * @param {Error} error - Error object
 * @returns {string} User-friendly error message
 */
function getErrorMessage(error) {
  if (!error) return 'Unknown error occurred';
  
  // Handle ExtensionError subclasses
  if (error instanceof ExtensionError) {
    return error.message;
  }
  
  // Handle Chrome runtime errors
  if (error.message && error.message.includes('Extension context invalidated')) {
    return 'Extension was reloaded. Please refresh the page.';
  }
  
  // Handle network errors
  if (error.message && error.message.includes('Failed to fetch')) {
    return 'Network error. Please check your connection.';
  }
  
  // Handle abort errors
  if (error.name === 'AbortError') {
    return 'Request timed out. Please try again.';
  }
  
  // Default to error message
  return error.message || 'Unknown error occurred';
}

/**
 * Log error with context
 * @param {Error} error - Error object
 * @param {string} context - Context where error occurred
 * @param {Object} additionalInfo - Additional information to log
 */
function logError(error, context, additionalInfo) {
  console.error(`[${context}] Error:`, error.message);
  
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  
  if (additionalInfo) {
    console.error('Additional info:', additionalInfo);
  }
  
  if (error instanceof ExtensionError) {
    console.error('Error code:', error.code);
    if (error.details) {
      console.error('Error details:', error.details);
    }
  }
}

/**
 * Wrap async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} Wrapped function
 */
function withErrorHandling(fn, context) {
  return async function(...args) {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error, context);
      throw error;
    }
  };
}

