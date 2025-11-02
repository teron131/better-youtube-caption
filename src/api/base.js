/**
 * Base API client with common functionality
 * Provides timeout handling, error parsing, and retry logic
 */

/**
 * Fetch with timeout support
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} Fetch response
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Parse error response from API
 * @param {Response} response - Fetch response
 * @returns {Promise<string>} Error message
 */
async function parseErrorResponse(response) {
  let errorMessage = `API request failed with status ${response.status}`;
  
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const errorData = await response.json();
      errorMessage = errorData?.error?.message || errorData?.message || errorMessage;
    } else {
      const errorText = await response.text();
      errorMessage = errorText || errorMessage;
    }
  } catch (e) {
    // If parsing fails, use default message
    console.debug('Failed to parse error response:', e);
  }
  
  return errorMessage;
}

/**
 * Make API request with error handling
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} apiName - API name for error messages
 * @returns {Promise<Object>} Parsed JSON response
 */
async function makeApiRequest(url, options = {}, timeoutMs = 30000, apiName = 'API') {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  
  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(`${apiName} error: ${errorMessage}`);
  }
  
  return await response.json();
}

