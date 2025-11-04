# Building the Summary Workflow

The summary workflow uses LangChain, LangGraph, and Zod libraries which need to be bundled for use in the Chrome extension.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the workflow:
```bash
npm run build
```

This will create `src/summaryWorkflow.bundle.js` which is used by `background.js`.

## Development

For watch mode during development:
```bash
npm run build:watch
```

## Dependencies

- `langchain` - LangChain core library
- `@langchain/langgraph` - LangGraph for workflow orchestration
- `@langchain/core` - Core LangChain types
- `zod` - Schema validation (equivalent to Pydantic in Python)
- `esbuild` - Bundler (dev dependency)

## How It Works

1. `src/summaryWorkflow.js` uses ES modules with LangChain/LangGraph/Zod
2. `build.js` bundles it into `src/summaryWorkflow.bundle.js` using esbuild
3. `background.js` loads the bundled version via `importScripts`
4. The bundled code exposes `executeSummarizationWorkflow` globally

