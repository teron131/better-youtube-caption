/**
 * Storage Management Utilities
 * Uses video IDs as storage keys for better robustness
 */

import { STORAGE, YOUTUBE } from "./constants.js";
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
 * Save subtitles for a video to local storage with quota management
 */
export function saveSubtitles(videoId, subtitles) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [videoId]: subtitles }, () => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message?.includes("QUOTA")) {
          console.warn("Storage quota exceeded, attempting cleanup...");
          cleanupOldSubtitles(STORAGE.CLEANUP_BATCH_SIZE)
            .then(() => {
              chrome.storage.local.set({ [videoId]: subtitles }, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(`Storage quota exceeded: ${chrome.runtime.lastError.message}`));
                } else {
                  console.log("Subtitles saved after cleanup for video:", videoId);
                  resolve();
                }
              });
            })
            .catch((error) => reject(new Error(`Storage quota exceeded and cleanup failed: ${error.message}`)));
        } else {
          reject(new Error(chrome.runtime.lastError.message));
        }
      } else {
        console.log("Subtitles saved to local storage for video ID:", videoId);
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
 */
export async function cleanupOldSubtitles(countToRemove = 10) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (allItems) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      // Filter for video IDs (11 chars, array values)
      const videoKeys = Object.keys(allItems).filter(
        (key) => key.length === YOUTUBE.VIDEO_ID_LENGTH && Array.isArray(allItems[key])
      );

      const keepCount = 5; // Keep at least 5 videos
      const removeCount =
        videoKeys.length <= countToRemove ? Math.max(1, videoKeys.length - keepCount) : countToRemove;

      const keysToRemove = videoKeys.slice(0, removeCount);
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
 * Proactively check and clean storage if needed
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
 * Get API key from storage
 */
export function getApiKeyFromStorage(keyName) {
  return new Promise((resolve) => {
    chrome.storage.local.get([keyName], (result) => {
      resolve(result[keyName] || null);
    });
  });
}

/**
 * Save API key to storage
 */
export function saveApiKey(keyName, apiKey) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [keyName]: apiKey }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Save a setting to storage
 * @param {string} key - Storage key
 * @param {*} value - Value to save
 */
export function saveSetting(key, value) {
  const settings = { [key]: value };
  chrome.storage.local.set(settings, () => {
    log('Auto-saved:', key, value);
  });
}
