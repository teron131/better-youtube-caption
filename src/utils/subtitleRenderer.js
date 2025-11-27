/**
 * Subtitle Renderer Module
 * Handles creation, display, and updates of subtitle elements on the YouTube video player.
 */

import { ELEMENT_IDS, FONT_SIZES, TIMING, YOUTUBE } from "../constants.js";
import { log as debugLog, error as logError, warn as logWarn } from "./logger.js";

let subtitleContainer = null;
let subtitleText = null;
let videoPlayer = null;
let videoContainer = null;
let checkInterval = null;

/**
 * Find video elements on the YouTube page
 * @returns {boolean} True if video elements found
 */
export function findVideoElements() {
  videoPlayer = document.querySelector(YOUTUBE.SELECTORS.VIDEO_PLAYER);
  if (!videoPlayer) return false;

  // Try finding a standard container, fallback to player's parent
  videoContainer =
    document.querySelector(YOUTUBE.SELECTORS.MOVIE_PLAYER) ||
    document.querySelector(YOUTUBE.SELECTORS.VIDEO_CONTAINER) ||
    videoPlayer.parentElement;

  return !!videoContainer;
}

/**
 * Create subtitle elements and append them to the video container
 */
export function createSubtitleElements() {
  if (document.getElementById(ELEMENT_IDS.SUBTITLE_CONTAINER)) {
    // If elements exist, just update references
    subtitleContainer = document.getElementById(ELEMENT_IDS.SUBTITLE_CONTAINER);
    subtitleText = document.getElementById(ELEMENT_IDS.SUBTITLE_TEXT);
    return;
  }

  subtitleContainer = document.createElement("div");
  subtitleContainer.id = ELEMENT_IDS.SUBTITLE_CONTAINER;
  subtitleContainer.style.position = "absolute";
  subtitleContainer.style.zIndex = "9999";
  subtitleContainer.style.pointerEvents = "none";
  subtitleContainer.style.display = "none";

  subtitleText = document.createElement("div");
  subtitleText.id = ELEMENT_IDS.SUBTITLE_TEXT;
  subtitleContainer.appendChild(subtitleText);

  if (videoContainer) {
    if (getComputedStyle(videoContainer).position === "static") {
      videoContainer.style.position = "relative";
    }
    videoContainer.appendChild(subtitleContainer);
    debugLog("Subtitle container added to video container.");
  } else {
    logError("Cannot add subtitle container, video container not found.");
  }
}

/**
 * Apply caption font size
 * @param {string} size - Size key (S, M, L)
 */
export function applyCaptionFontSize(size) {
  const sizeConfig = FONT_SIZES.CAPTION[size] || FONT_SIZES.CAPTION.M;
  
  // Update CSS custom properties for consistency
  document.documentElement.style.setProperty("--caption-font-size-base", sizeConfig.base);
  document.documentElement.style.setProperty("--caption-font-size-max", sizeConfig.max);
  document.documentElement.style.setProperty("--caption-font-size-min", sizeConfig.min);
  document.documentElement.style.setProperty("--caption-font-size-fullscreen", sizeConfig.fullscreen);
  document.documentElement.style.setProperty("--caption-font-size-fullscreen-max", sizeConfig.fullscreenMax);

  // Apply to element directly if it exists, using clamp for responsiveness
  if (subtitleText) {
    subtitleText.style.fontSize = `clamp(${sizeConfig.min}, ${sizeConfig.base}, ${sizeConfig.max})`;
  }
}

/**
 * Update subtitles based on the current video time
 * @param {Array} currentSubtitles - Array of subtitle objects
 */
function updateSubtitlesInternal(currentSubtitles) {
  if (!videoPlayer || !subtitleText || !subtitleContainer) {
    return;
  }

  if (isNaN(videoPlayer.currentTime)) return;

  const currentTime = videoPlayer.currentTime * 1000; // Convert to ms
  let foundSubtitle = null;

  for (const subtitle of currentSubtitles) {
    if (currentTime >= subtitle.startTime && currentTime <= subtitle.endTime) {
      foundSubtitle = subtitle;
      break;
    }
  }

  if (foundSubtitle) {
    if (subtitleText.textContent !== foundSubtitle.text) {
      subtitleText.textContent = foundSubtitle.text;
    }
    subtitleContainer.style.display = "block";
  } else {
    hideCurrentSubtitle();
  }
}

/**
 * Start displaying subtitles
 * @param {Array} currentSubtitles - Array of subtitle objects
 */
export function startSubtitleDisplay(currentSubtitles) {
  if (!videoPlayer || !subtitleContainer) {
    logWarn("Cannot start subtitle display: Player or container missing.");
    return;
  }

  stopSubtitleDisplay();

  debugLog("Starting subtitle display interval.");
  
  // Create a bound function to hold the subtitles closure
  const updateFn = () => updateSubtitlesInternal(currentSubtitles);
  
  checkInterval = setInterval(updateFn, TIMING.SUBTITLE_UPDATE_INTERVAL_MS);

  videoPlayer.addEventListener("play", updateFn);
  videoPlayer.addEventListener("seeked", updateFn);
  
  // Store the function reference on the element to remove it later if needed
  videoPlayer._subtitleUpdateFn = updateFn;
}

/**
 * Stop displaying subtitles
 */
export function stopSubtitleDisplay() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    debugLog("Stopped subtitle display interval.");
  }
  if (videoPlayer && videoPlayer._subtitleUpdateFn) {
    videoPlayer.removeEventListener("play", videoPlayer._subtitleUpdateFn);
    videoPlayer.removeEventListener("seeked", videoPlayer._subtitleUpdateFn);
    delete videoPlayer._subtitleUpdateFn;
  }
}

/**
 * Hide the current subtitle
 */
export function hideCurrentSubtitle() {
  if (subtitleContainer) {
    subtitleContainer.style.display = "none";
  }
  if (subtitleText) {
    subtitleText.textContent = "";
  }
}

export function clearRenderer() {
  stopSubtitleDisplay();
  hideCurrentSubtitle();
}

