/**
 * Chrome storage management for subtitles and settings
 */

import { STORAGE, YOUTUBE, STORAGE_CLEANUP } from "./constants.js";
import { log } from "./utils/logger.js";

/**
 * Get subtitles for a video from local storage
 */
export function getStoredSubtitles(videoId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([videoId], (result) => {
      resolve(result[videoId] || null);
    });
  });
}

/**
 * Save subtitles for a video to local storage
 * Automatically handles quota exceeded by cleaning old entries
 */
export async function saveSubtitles(videoId, subtitles) {
  try {
    await chromeStorageSet({ [videoId]: subtitles });
    console.log("Subtitles saved to local storage for video ID:", videoId);
  } catch (error) {
    if (error.message?.includes("QUOTA")) {
      console.warn("Storage quota exceeded, attempting cleanup...");
      await cleanupOldSubtitles(STORAGE.CLEANUP_BATCH_SIZE);
      await chromeStorageSet({ [videoId]: subtitles });
      console.log("Subtitles saved after cleanup for video:", videoId);
    } else {
      throw error;
    }
  }
}

/**
 * Wrapper for chrome.storage.local.set with promise interface
 */
function chromeStorageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get storage usage information
 */
export function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
      resolve({
        bytesUsed: bytesInUse || 0,
        bytesAvailable: STORAGE.QUOTA_BYTES - (bytesInUse || 0),
        percentageUsed: ((bytesInUse || 0) / STORAGE.QUOTA_BYTES) * 100,
      });
    });
  });
}

/**
 * Clean up old subtitles when storage is full
 * Removes oldest videos while keeping a minimum number
 */
export async function cleanupOldSubtitles(countToRemove = 10) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (allItems) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const videoKeys = getVideoKeys(allItems);
      const keysToRemove = selectKeysToRemove(videoKeys, countToRemove);

      chrome.storage.local.remove(keysToRemove, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log(`Removed ${keysToRemove.length} old video transcripts`);
          resolve();
        }
      });
    });
  });
}

/**
 * Get all video keys from storage items
 */
function getVideoKeys(allItems) {
  return Object.keys(allItems).filter(
    key => key.length === YOUTUBE.VIDEO_ID_LENGTH && Array.isArray(allItems[key])
  );
}

/**
 * Select which keys to remove during cleanup
 */
function selectKeysToRemove(videoKeys, countToRemove) {
  const removeCount = videoKeys.length <= countToRemove
    ? Math.max(1, videoKeys.length - STORAGE_CLEANUP.MIN_VIDEOS_TO_KEEP)
    : countToRemove;

  return videoKeys.slice(0, removeCount);
}

/**
 * Proactively check and clean storage if nearing limit
 */
export async function ensureStorageSpace() {
  const usage = await getStorageUsage();

  if (usage.bytesUsed > STORAGE.MAX_STORAGE_BYTES) {
    console.log(`Storage usage at ${usage.percentageUsed.toFixed(1)}%, cleaning up...`);
    const videosToRemove = Math.ceil(
      (usage.bytesUsed - STORAGE.MAX_STORAGE_BYTES) / STORAGE.ESTIMATED_VIDEO_SIZE_BYTES
    );
    await cleanupOldSubtitles(videosToRemove);
  }
}

/**
 * Get value from storage
 */
export function getStorageValue(keyName) {
  return new Promise((resolve) => {
    chrome.storage.local.get([keyName], (result) => {
      resolve(result[keyName] || null);
    });
  });
}

/**
 * Get API key from storage
 */
export const getApiKeyFromStorage = getStorageValue;

/**
 * Save value to storage
 */
export function setStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Save setting to storage (synchronous callback-based)
 */
export function saveSetting(key, value) {
  chrome.storage.local.set({ [key]: value }, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to save setting:', key, chrome.runtime.lastError);
    } else {
      log('Auto-saved:', key, value);
    }
  });
}
