/**
 * Centralized logging utility for Better YouTube Caption extension
 * Provides consistent log formatting and log level control
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Set current log level (can be configured)
const CURRENT_LOG_LEVEL = LOG_LEVELS.DEBUG;

/**
 * Logger class for consistent logging across the extension
 */
class Logger {
  constructor(context) {
    this.context = context; // e.g., "Background", "Content", "Popup"
  }

  /**
   * Format log message with context and timestamp
   * @private
   */
  _format(level, message, data) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[${timestamp}] [${this.context}] [${level}]`;
    
    if (data !== undefined) {
      return [prefix, message, data];
    }
    return [prefix, message];
  }

  /**
   * Log debug message (lowest priority)
   */
  debug(message, data) {
    if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) {
      console.log(...this._format('DEBUG', message, data));
    }
  }

  /**
   * Log info message
   */
  info(message, data) {
    if (CURRENT_LOG_LEVEL <= LOG_LEVELS.INFO) {
      console.log(...this._format('INFO', message, data));
    }
  }

  /**
   * Log warning message
   */
  warn(message, data) {
    if (CURRENT_LOG_LEVEL <= LOG_LEVELS.WARN) {
      console.warn(...this._format('WARN', message, data));
    }
  }

  /**
   * Log error message (highest priority)
   */
  error(message, data) {
    if (CURRENT_LOG_LEVEL <= LOG_LEVELS.ERROR) {
      console.error(...this._format('ERROR', message, data));
    }
  }
}

/**
 * Create a logger instance for a specific context
 * @param {string} context - Context name (e.g., "Background", "Content", "Popup")
 * @returns {Logger} Logger instance
 */
function createLogger(context) {
  return new Logger(context);
}

