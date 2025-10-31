# Configuration for Testing

## Using config.js for Development

For testing purposes, you can set API keys directly in `config.js` instead of entering them in the browser popup.

### Setup

1. Create or edit `config.js` in the project root:
```javascript
const TEST_CONFIG = {
  geminiApiKey: "your-gemini-api-key-here",
  openRouterApiKey: "your-openrouter-api-key-here",
  scrapeCreatorsApiKey: "your-scrapecreators-api-key-here",
  useTestConfig: true,  // Set to true to enable test config
};
```

2. Set `useTestConfig: true` to override browser storage values
3. Set `useTestConfig: false` or leave keys as `null` to use browser storage instead

### Notes

- `config.js` is gitignored - it won't be committed to the repository
- In production, API keys should be stored in browser storage via the popup UI
- The background script checks `config.js` first if `useTestConfig` is enabled
- Always use browser storage for end-user distribution

### Security

⚠️ **Never commit API keys to the repository!** The `config.js` file is already in `.gitignore`.

