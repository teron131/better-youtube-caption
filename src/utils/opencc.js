/**
 * OpenCC Conversion Utility
 * Converts Simplified Chinese to Traditional Chinese (s2t)
 * Uses opencc-js library (bundled)
 */

import { Converter } from 'opencc-js/cn2t';

let openccConverter = null;

/**
 * Initialize OpenCC converter (lazy load)
 * @returns {Object} OpenCC converter instance
 */
function getOpenCCConverter() {
  if (openccConverter) {
    return openccConverter;
  }

  try {
    // Use the pre-configured Converter from cn2t preset
    // Call Converter with options to get the actual converter function
    // cn2t = Simplified Chinese (cn) to Traditional Chinese (tw)
    openccConverter = Converter({ from: 'cn', to: 'tw' });
    return openccConverter;
  } catch (error) {
    console.warn('Failed to initialize OpenCC converter:', error);
    return null;
  }
}

/**
 * Convert Simplified Chinese to Traditional Chinese
 * Safe to call on any text - non-Chinese text will remain unchanged
 * @param {string} text - Text to convert
 * @returns {string} Converted text
 */
function convertS2T(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  try {
    const converter = getOpenCCConverter();
    if (!converter) {
      // If converter failed to load, return original text
      return text;
    }
    
    // Convert text (s2t) - converter is a function
    const converted = converter(text);
    return converted || text;
  } catch (error) {
    console.warn('OpenCC conversion error, returning original text:', error);
    return text;
  }
}

/**
 * Convert array of segments (for captions)
 * Optimized: Converts all text at once as a large string, then splits back
 * This is much faster than converting many small strings individually
 * @param {Array} segments - Array of segment objects with text property
 * @returns {Array} Segments with converted text
 */
function convertSegmentsS2T(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return segments;
  }

  const converter = getOpenCCConverter();
  if (!converter) {
    return segments;
  }

  // Use a unique delimiter that won't appear in text
  // Using a combination that's extremely unlikely in Chinese/English text
  const DELIMITER = '\u0001\u0002\u0003\u0004\u0005';
  
  // Extract texts and build mapping (index in segments -> index in texts array)
  const texts = [];
  const segmentToTextIndex = new Map();
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.text && typeof segment.text === 'string') {
      segmentToTextIndex.set(i, texts.length);
      texts.push(segment.text);
    }
  }
  
  if (texts.length === 0) {
    return segments;
  }
  
  // Join all texts with delimiter and convert as one large string
  // This is much faster than converting many small strings individually
  const joinedText = texts.join(DELIMITER);
  const convertedJoinedText = converter(joinedText);
  
  // Split back and assign to segments
  const convertedTexts = convertedJoinedText.split(DELIMITER);
  
  // Create result array with converted texts
  const result = segments.map((segment, index) => {
    const textIndex = segmentToTextIndex.get(index);
    if (textIndex !== undefined && convertedTexts[textIndex] !== undefined) {
      return { ...segment, text: convertedTexts[textIndex] };
    }
    return segment;
  });
  
  return result;
}

// Export functions for use in service worker (via importScripts)
export { convertS2T, convertSegmentsS2T };

// Also assign to global scope for service worker compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.convertS2T = convertS2T;
  globalThis.convertSegmentsS2T = convertSegmentsS2T;
}
if (typeof self !== 'undefined') {
  self.convertS2T = convertS2T;
  self.convertSegmentsS2T = convertSegmentsS2T;
}
