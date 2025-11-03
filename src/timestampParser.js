/**
 * Timestamp Parser Module
 * Utilities for parsing SRT timestamps and converting time formats
 */

/**
 * Convert time string to milliseconds
 * Supports HH:MM:SS,ms and MM:SS,ms formats
 */
function timeStringToMs(timeStr) {
  if (!timeStr) return 0;

  const trimmed = timeStr.trim();

  // HH:MM:SS,ms format
  let match = trimmed.match(/(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})[.,](\d{3})/);
  if (match) {
    const [, hours, minutes, seconds, milliseconds] = match.map((x) => parseInt(x, 10));
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
  }

  // MM:SS,ms format
  match = trimmed.match(/(\d{2})\s*:\s*(\d{2})[.,](\d{3})/);
  if (match) {
    const [, minutes, seconds, milliseconds] = match.map((x) => parseInt(x, 10));
    return minutes * 60000 + seconds * 1000 + milliseconds;
  }

  console.warn("Could not parse time string:", trimmed);
  return 0;
}

/**
 * Parse SRT text into subtitle objects
 */
function parseSrt(srtText) {
  if (!srtText || typeof srtText !== "string") {
    console.error("Invalid SRT text input:", srtText);
    return [];
  }

  const subtitles = [];
  const srtBlockRegex =
    /(\d+)\s*([\d:,.-]+)\s*-->\s*([\d:,.-]+)\s*((?:.|\n(?!(\d+\s*[\d:,.-]+\s*-->)))+)/g;

  let match;
  while ((match = srtBlockRegex.exec(srtText)) !== null) {
    const index = parseInt(match[1], 10);
    const startTimeStr = match[2].trim().replace(".", ",");
    const endTimeStr = match[3].trim().replace(".", ",");
    const text = match[4].trim().replace(/[\r\n]+/g, " ");

    const startTime = timeStringToMs(startTimeStr);
    const endTime = timeStringToMs(endTimeStr);

    if (!isNaN(startTime) && !isNaN(endTime) && text) {
      subtitles.push({ startTime, endTime, text });
    } else {
      console.warn(`Skipping malformed SRT block at index ${index}`);
    }
  }

  if (!subtitles.length && srtText.trim().length > 0) {
    console.warn("Could not parse any valid SRT blocks");
  }

  console.log("Parsed subtitles count:", subtitles.length);
  return subtitles;
}

// Export
if (typeof module !== "undefined" && module.exports) {
  module.exports = { timeStringToMs, parseSrt };
}
