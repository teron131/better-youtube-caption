// URL utility functions

// Cleans a YouTube URL to extract only the video ID and essential parameters
function cleanYouTubeUrl(originalUrl) {
  try {
    const url = new URL(originalUrl);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      return `${url.protocol}//${url.hostname}${url.pathname}?v=${videoId}`;
    }
  } catch (e) {
    console.error("Error parsing URL for cleaning:", originalUrl, e);
  }
  return originalUrl;
}

// Extracts video ID from YouTube URL
function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  } catch (e) {
    console.error("Error extracting video ID:", url, e);
    return null;
  }
}

