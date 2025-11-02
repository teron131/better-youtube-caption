/**
 * OpenRouter API client
 * Handles all interactions with the OpenRouter API for LLM inference
 */

/**
 * Call OpenRouter API for chat completion
 * @param {Object} params - API parameters
 * @param {string} params.apiKey - OpenRouter API key
 * @param {string} params.model - Model ID (e.g., "google/gemini-2.5-flash-lite")
 * @param {Array} params.messages - Array of message objects {role, content}
 * @param {number} params.temperature - Temperature (0-1)
 * @param {number} params.timeoutMs - Timeout in milliseconds (default: 120000)
 * @param {Function} params.progressCallback - Optional progress callback
 * @returns {Promise<string>} Generated text content
 */
async function chatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0,
  timeoutMs = 120000,
  progressCallback = null,
}) {
  if (!apiKey) {
    throw new Error('OpenRouter API key is required');
  }
  
  if (!model) {
    throw new Error('Model ID is required');
  }
  
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required');
  }
  
  // Calculate approximate input size for logging
  const inputSize = JSON.stringify(messages).length;
  console.log(`OpenRouter: Sending ${inputSize} chars to model ${model}`);
  
  if (progressCallback) {
    progressCallback(`Sending request to ${model}...`);
  }
  
  // Setup timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(API_ENDPOINTS.OPENROUTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'Better YouTube Caption',
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: temperature,
        provider: {
          sort: 'throughput',
        },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      let errorMessage = `API request failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData?.error?.message || errorMessage;
      } catch (e) {
        const errorText = await response.text();
        errorMessage = errorText || errorMessage;
      }
      throw new Error(`OpenRouter API error: ${errorMessage}`);
    }
    
    console.log('OpenRouter: Received response, parsing...');
    const data = await response.json();
    
    // Extract content from response
    if (!data.choices || data.choices.length === 0 || !data.choices[0].message?.content) {
      throw new Error('Invalid response format from OpenRouter API');
    }
    
    const content = data.choices[0].message.content.trim();
    console.log(`OpenRouter: Received ${content.length} characters in response`);
    
    if (progressCallback) {
      progressCallback('Response received successfully');
    }
    
    return content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`OpenRouter API request timed out after ${timeoutMs / 1000} seconds. The input may be too long.`);
    }
    throw error;
  }
}

/**
 * Validate model ID format
 * @param {string} modelId - Model ID to validate
 * @returns {boolean} True if valid
 */
function isValidModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') {
    return false;
  }
  
  // Model IDs should be in format: provider/model-name
  return /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(modelId);
}

