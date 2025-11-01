// Storage management utilities
// Note: Video IDs are used as storage keys instead of URLs for better robustness

// Get subtitles for a video from local storage (using video ID as key)
function getStoredSubtitles(videoId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([videoId], (result) => {
      resolve(result[videoId] || null);
    });
  });
}

// Save subtitles for a video to local storage (using video ID as key)
function saveSubtitles(videoId, subtitles) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [videoId]: subtitles }, () => {
      if (chrome.runtime.lastError) {
        // Check if it's a quota exceeded error
        if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes("QUOTA")) {
          console.warn("Storage quota exceeded. Attempting cleanup...");
          // Try to free up space and retry
          cleanupOldSubtitles(STORAGE.CLEANUP_BATCH_SIZE)
            .then(() => {
              // Retry saving
              chrome.storage.local.set({ [videoId]: subtitles }, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(`Storage quota exceeded and cleanup failed: ${chrome.runtime.lastError.message}`));
                } else {
                  console.log("Subtitles saved to local storage for video ID:", videoId);
                  resolve();
                }
              });
            })
            .catch((cleanupError) => {
              reject(new Error(`Storage quota exceeded and cleanup failed: ${cleanupError.message}`));
            });
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

// Get storage usage information
function getStorageUsage() {
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

// Clean up old subtitles when storage is getting full
// Removes the oldest N videos based on access time (if we tracked it) or removes oldest keys
async function cleanupOldSubtitles(countToRemove = 10) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (allItems) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      // Filter out API keys and other non-video data
      // Video IDs are typically 11 characters (YouTube video ID format)
      const videoKeys = Object.keys(allItems).filter((key) => {
        // YouTube video IDs are 11 characters, but also check if it's an array (subtitle segments)
        return key.length === YOUTUBE.VIDEO_ID_LENGTH && Array.isArray(allItems[key]);
      });

      if (videoKeys.length <= countToRemove) {
        // If we have fewer videos than we want to remove, remove all except the most recent ones
        const keepCount = 5; // Keep at least 5 most recent videos
        const removeCount = Math.max(1, videoKeys.length - keepCount);
        console.log(`Only ${videoKeys.length} videos found, removing oldest ${removeCount}`);
        const keysToRemove = videoKeys.slice(0, removeCount);
        chrome.storage.local.remove(keysToRemove, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log(`Removed ${keysToRemove.length} old video transcripts`);
            resolve();
          }
        });
      } else {
        // Remove the oldest N videos (simple approach: remove first N)
        const keysToRemove = videoKeys.slice(0, countToRemove);
        chrome.storage.local.remove(keysToRemove, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log(`Removed ${keysToRemove.length} old video transcripts`);
            resolve();
          }
        });
      }
    });
  });
}

// Proactively check and clean storage if needed
async function ensureStorageSpace() {
  const usage = await getStorageUsage();
  
  if (usage.bytesUsed > STORAGE.MAX_STORAGE_BYTES) {
    console.log(`Storage usage at ${usage.percentageUsed.toFixed(1)}%, cleaning up...`);
    const videosToRemove = Math.ceil((usage.bytesUsed - STORAGE.MAX_STORAGE_BYTES) / STORAGE.ESTIMATED_VIDEO_SIZE_BYTES);
    await cleanupOldSubtitles(videosToRemove);
  }
}

// Get API key from storage
function getApiKeyFromStorage(keyName) {
  return new Promise((resolve) => {
    chrome.storage.local.get([keyName], (result) => {
      resolve(result[keyName] || null);
    });
  });
}

// Save API key to storage
function saveApiKey(keyName, apiKey) {
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

