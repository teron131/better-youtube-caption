/**
 * OpenCC Conversion Utility
 * 
 * Converts Simplified Chinese to Traditional Chinese (s2t).
 * Uses the opencc-js library bundled for Chrome extension service worker.
 * 
 * The conversion is always enabled and applied automatically to:
 * - Generated summaries
 * - Refined subtitle segments
 */

import { Converter } from 'opencc-js/cn2t';

// Lazy-loaded converter instance
let openccConverter = null;

/**
 * Initialize OpenCC converter (lazy load, singleton pattern)
 * @returns {Function|null} OpenCC converter function, or null if initialization fails
 */
function getOpenCCConverter() {
  if (openccConverter) {
    return openccConverter;
  }

  try {
    // Use the cn2t preset (Simplified Chinese to Traditional Chinese)
    // Converter is a factory function that returns the actual converter
    openccConverter = Converter({ from: 'cn', to: 'tw' });
    return openccConverter;
  } catch (error) {
    console.warn('Failed to initialize OpenCC converter:', error);
    return null;
  }
}

/**
 * Convert Simplified Chinese to Traditional Chinese
 * 
 * Safe to call on any text - non-Chinese text will remain unchanged.
 * Returns the original text if conversion fails or converter is unavailable.
 * 
 * @param {string} text - Text to convert
 * @returns {string} Converted text (or original if conversion fails)
 */
function convertS2T(text) {
  // Early return for invalid input
  if (!text || typeof text !== 'string') {
    return text;
  }

  try {
    const converter = getOpenCCConverter();
    if (!converter) {
      return text;
    }
    
    const converted = converter(text);
    return converted || text;
  } catch (error) {
    console.warn('OpenCC conversion error, returning original text:', error);
    return text;
  }
}

/**
 * Convert array of subtitle segments from Simplified to Traditional Chinese
 * 
 * Optimized batch conversion: Joins all segment texts into a single large string,
 * converts it once, then splits back. This is significantly faster than converting
 * many small strings individually, reducing latency.
 * 
 * Preserves all segment properties (start, end, etc.) and only modifies the text.
 * 
 * @param {Array<Object>} segments - Array of segment objects with text property
 * @returns {Array<Object>} Segments with converted text (or original if conversion fails)
 */
function convertSegmentsS2T(segments) {
  // Early return for invalid input
  if (!Array.isArray(segments) || segments.length === 0) {
    return segments;
  }

  const converter = getOpenCCConverter();
  if (!converter) {
    return segments;
  }

  // Use a unique delimiter that won't appear in text
  // Control characters that are extremely unlikely in Chinese/English text
  const DELIMITER = '\u0001\u0002\u0003\u0004\u0005';
  
  // Extract texts and build mapping (segment index -> text array index)
  const texts = [];
  const segmentToTextIndex = new Map();
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment?.text && typeof segment.text === 'string') {
      segmentToTextIndex.set(i, texts.length);
      texts.push(segment.text);
    }
  }
  
  // Early return if no valid texts found
  if (texts.length === 0) {
    return segments;
  }
  
  try {
    // Batch conversion: join all texts, convert once, then split
    const joinedText = texts.join(DELIMITER);
    const convertedJoinedText = converter(joinedText);
    const convertedTexts = convertedJoinedText.split(DELIMITER);
    
    // Map converted texts back to segments while preserving all properties
    return segments.map((segment, index) => {
      const textIndex = segmentToTextIndex.get(index);
      if (textIndex !== undefined && convertedTexts[textIndex] !== undefined) {
        return { ...segment, text: convertedTexts[textIndex] };
      }
      return segment;
    });
  } catch (error) {
    console.warn('OpenCC batch conversion error, returning original segments:', error);
    return segments;
  }
}

// Export functions for ES modules
export { convertS2T, convertSegmentsS2T };

// Also expose to global scope for service worker compatibility
// Service workers use importScripts which doesn't support ES modules,
// so we need to assign functions to global scope
if (typeof globalThis !== 'undefined') {
  globalThis.convertS2T = convertS2T;
  globalThis.convertSegmentsS2T = convertSegmentsS2T;
}
if (typeof self !== 'undefined') {
  self.convertS2T = convertS2T;
  self.convertSegmentsS2T = convertSegmentsS2T;
}
