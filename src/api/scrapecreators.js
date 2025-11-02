/**
 * Scrape Creators API client
 * Handles YouTube transcript fetching via Scrape Creators API
 */

/**
 * Fetch YouTube transcript and metadata
 * @param {Object} params - API parameters
 * @param {string} params.videoUrl - YouTube video URL
 * @param {string} params.apiKey - Scrape Creators API key
 * @returns {Promise<Object>} Transcript data with segments, title, description
 */
async function fetchTranscript({ videoUrl, apiKey }) {
  if (!apiKey) {
    throw new Error('Scrape Creators API key is required');
  }
  
  if (!videoUrl) {
    throw new Error('Video URL is required');
  }
  
  // Clean the YouTube URL
  const cleanedUrl = cleanYouTubeUrl(videoUrl);
  
  // Build API URL
  const apiUrl = `${API_ENDPOINTS.SCRAPE_CREATORS}?url=${encodeURIComponent(cleanedUrl)}&get_transcript=true`;
  
  console.log(`ScrapeCreators: Fetching transcript for ${cleanedUrl}`);
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  });
  
  if (!response.ok) {
    let errorMessage = `API request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorMessage;
    } catch (e) {
      errorMessage = await response.text() || errorMessage;
    }
    throw new Error(`Scrape Creators API error: ${errorMessage}`);
  }
  
  const data = await response.json();
  
  // Validate response
  if (!data.transcript || !Array.isArray(data.transcript) || data.transcript.length === 0) {
    throw new Error('No transcript available for this video');
  }
  
  // Convert transcript segments to standardized format
  const segments = parseTranscriptSegments(data.transcript);
  
  if (segments.length === 0) {
    throw new Error('No valid transcript segments found');
  }
  
  console.log(`ScrapeCreators: Fetched ${segments.length} transcript segments`);
  
  return {
    segments: segments,
    title: data.title || '',
    description: data.description || '',
    transcriptText: data.transcript_only_text || '',
  };
}

/**
 * Parse transcript segments from API response
 * @param {Array} rawSegments - Raw segments from API
 * @returns {Array} Parsed segments with standardized format
 */
function parseTranscriptSegments(rawSegments) {
  return rawSegments
    .map((segment) => {
      const startTime = parseInt(segment.startMs, 10);
      const endTime = parseInt(segment.endMs, 10);
      
      if (isNaN(startTime) || isNaN(endTime)) {
        console.warn('Invalid timestamp in transcript segment:', segment);
        return null;
      }
      
      return {
        startTime: startTime,
        endTime: endTime,
        text: segment.text.trim(),
        startTimeText: segment.startTimeText || null,
      };
    })
    .filter((segment) => segment !== null);
}

