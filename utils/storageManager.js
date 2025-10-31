// Storage management utilities

// Get subtitles for a video from local storage
function getStoredSubtitles(videoUrl) {
  return new Promise((resolve) => {
    chrome.storage.local.get([videoUrl], (result) => {
      resolve(result[videoUrl] || null);
    });
  });
}

// Save subtitles for a video to local storage
function saveSubtitles(videoUrl, subtitles) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [videoUrl]: subtitles }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log("Subtitles saved to local storage for:", videoUrl);
        resolve();
      }
    });
  });
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

