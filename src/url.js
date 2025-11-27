/**
 * URL Utility Functions
 */

/**
 * Clean YouTube URL to extract only video ID and essential parameters
 */
export function cleanYouTubeUrl(originalUrl) {
  try {
    const url = new URL(originalUrl);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      return `${url.protocol}//${url.hostname}${url.pathname}?v=${videoId}`;
    }
  } catch (e) {
    console.error("Error parsing URL:", originalUrl, e);
  }
  return originalUrl;
}

/**
 * Extract video ID from YouTube URL
 */
export function extractVideoId(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("v");
  } catch (e) {
    console.error("Error extracting video ID:", url, e);
    return null;
  }
}
