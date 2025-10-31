// YouTube transcript fetcher using Scrape Creators API
// Docs: https://docs.scrapecreators.com/v1/youtube/video

/**
 * Fetches YouTube transcript and metadata using Scrape Creators API
 * @param {string} videoUrl - YouTube video URL
 * @param {string} apiKey - Scrape Creators API key
 * @returns {Promise<Object>} Object with segments array and metadata: {segments: Array, title: string, description: string, transcriptText: string}
 */
async function fetchYouTubeTranscript(videoUrl, apiKey) {
  if (!apiKey) {
    throw new Error("Scrape Creators API key is required");
  }

  // Clean the YouTube URL
  const cleanedUrl = cleanYouTubeUrl(videoUrl);
  
  // Call Scrape Creators API
  const apiUrl = `https://api.scrapecreators.com/v1/youtube/video?url=${encodeURIComponent(cleanedUrl)}&get_transcript=true`;
  
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });

  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorMessage;
    } catch (e) {
      // If response is not JSON, use status text
      errorMessage = await response.text() || errorMessage;
    }
    throw new Error(`Scrape Creators API error: ${errorMessage}`);
  }

  const data = await response.json();

  // Extract transcript segments
  if (!data.transcript || !Array.isArray(data.transcript) || data.transcript.length === 0) {
    throw new Error("No transcript available for this video");
  }

  // Convert transcript segments to our format
  // API returns: {text, startMs, endMs, startTimeText}
  // We need: {startTime, endTime, text} where times are in milliseconds (numbers)
  const segments = data.transcript.map((segment) => {
    const startTime = parseInt(segment.startMs, 10);
    const endTime = parseInt(segment.endMs, 10);

    if (isNaN(startTime) || isNaN(endTime)) {
      console.warn("Invalid timestamp in transcript segment:", segment);
      return null;
    }

    return {
      startTime: startTime,
      endTime: endTime,
      text: segment.text.trim(),
    };
  }).filter((segment) => segment !== null);

  if (segments.length === 0) {
    throw new Error("No valid transcript segments found");
  }

  console.log(`Fetched ${segments.length} transcript segments from Scrape Creators API`);
  
  // Return segments with metadata for refinement
  return {
    segments: segments,
    title: data.title || "",
    description: data.description || "",
    transcriptText: data.transcript_only_text || "",
  };
}

