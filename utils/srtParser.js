// SRT parsing utilities

// Converts a time string (e.g., "00:01:23,456") to milliseconds
function timeStringToMs(timeStr) {
  if (!timeStr) return 0;

  const trimmedTimeStr = timeStr.trim();

  // Match HH:MM:SS,ms format
  let match = trimmedTimeStr.match(
    /(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})[.,](\d{3})/
  );
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const milliseconds = parseInt(match[4], 10);
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
  }

  // Match MM:SS,ms format (missing hours)
  match = trimmedTimeStr.match(/(\d{2})\s*:\s*(\d{2})[.,](\d{3})/);
  if (match) {
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const milliseconds = parseInt(match[3], 10);
    return minutes * 60000 + seconds * 1000 + milliseconds;
  }

  console.warn("Could not parse time string:", `"${trimmedTimeStr}"`);
  return 0;
}

// Parses SRT text into an array of subtitle objects
function parseSrt(srtText) {
  if (!srtText || typeof srtText !== "string") {
    console.error("Invalid SRT text input:", srtText);
    return [];
  }

  console.log("Attempting to parse SRT:\n", srtText);

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
      console.warn(
        `Skipping malformed SRT block near index ${index}:`,
        match[0]
      );
    }
  }

  if (subtitles.length === 0 && srtText.trim().length > 0) {
    console.warn("Could not parse any valid SRT blocks from the text.");
  }

  console.log("Parsed subtitles count:", subtitles.length);
  return subtitles;
}

