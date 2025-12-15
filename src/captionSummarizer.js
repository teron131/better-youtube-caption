/**
 * Summary Workflow using LangChain, LangGraph, and Zod
 * Implements analysis generation with quality verification and refinement loop
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { END, START, StateGraph } from "@langchain/langgraph/web";
import { ChatOpenAI } from "@langchain/openai";
import { getExtensionUrl } from "./utils/contextValidation.js";
import { PromptBuilder } from "./utils/promptBuilder.js";
import { QualityUtils, SUMMARY_CONFIG } from "./utils/qualityUtils.js";
import { AnalysisSchema, GraphStateSchema, QualitySchema } from "./utils/schemas.js";

// ============================================================================
// Model Client
// ============================================================================

/**
 * Create OpenRouter LLM instance using LangChain
 */
function createOpenRouterLLM(model, apiKey) {
  return new ChatOpenAI({
    model: model,
    apiKey: apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": getExtensionUrl(),
        "X-Title": "Better YouTube Caption",
      },
    },
    temperature: 0.0,
    use_responses_api: true,
    reasoning: { effort: "medium" },
    extra_body: {
      include_reasoning: false,
      provider: { sort: "throughput" },
    },
  });
}

// ============================================================================
// Graph Nodes
// ============================================================================

/**
 * Analysis node: Generate or refine analysis
 */
async function analysisNode(state) {
  const apiKey = state.apiKey;
  const progressCallback = state.progressCallback;

  if (progressCallback) {
    if (state.quality && state.analysis) {
      progressCallback("🔧 Refining analysis based on quality feedback...");
    } else {
      progressCallback(
        `📝 Generating initial analysis. Transcript length: ${state.transcript.length} characters`
      );
    }
  }

  const llm = createOpenRouterLLM(state.analysis_model, apiKey);
  const structuredLLM = llm.withStructuredOutput(AnalysisSchema, {
    method: "jsonMode",
  });

  let prompt;

  // Refinement path
  if (state.quality && state.analysis) {
    const improvementContext = `# Improve this video analysis based on the following feedback:

## Analysis:

${JSON.stringify(state.analysis, null, 2)}

## Quality Assessment:

${JSON.stringify(state.quality, null, 2)}

Please provide an improved version that addresses the specific issues identified above to improve the overall quality score.`;

    const improvementSystemPrompt = PromptBuilder.buildImprovementPrompt();
    const transcriptContext = `Original Transcript:\n${state.transcript}`;
    const fullImprovementPrompt = `${transcriptContext}\n\n${improvementContext}`;

    // Include language instruction in refinement prompt too
    const languageInstruction = PromptBuilder._getLanguageInstruction(state.target_language || "auto", true);

    prompt = ChatPromptTemplate.fromMessages([
      ["system", improvementSystemPrompt + languageInstruction],
      ["human", "{improvement_prompt}"],
    ]);

    const chain = prompt.pipe(structuredLLM);
    const result = await chain.invoke({
      improvement_prompt: fullImprovementPrompt,
    });

    if (progressCallback) {
      progressCallback("✨ Analysis refined successfully");
    }

    return {
      analysis: result,
      iteration_count: state.iteration_count + 1,
    };
  } else {
    // Generation path
    const targetLang = state.target_language || "auto";
    const analysisPrompt = PromptBuilder.buildAnalysisPrompt(targetLang);

    // Add language reminder to human message for non-auto languages
    const humanMessage = targetLang === "auto" 
      ? "{content}"
      : `{content}\n\nRemember: Write ALL output in ${PromptBuilder.LANGUAGE_DESCRIPTIONS[targetLang] || targetLang}. Do not use English or any other language.`;

    prompt = ChatPromptTemplate.fromMessages([
      ["system", analysisPrompt],
      ["human", humanMessage],
    ]);

    const chain = prompt.pipe(structuredLLM);
    const result = await chain.invoke({ content: state.transcript });

    if (progressCallback) {
      progressCallback("📊 Analysis completed");
    }

    return {
      analysis: result,
      iteration_count: state.iteration_count + 1,
    };
  }
}

/**
 * Quality node: Evaluate analysis quality
 */
async function qualityNode(state) {
  const apiKey = state.apiKey;
  const progressCallback = state.progressCallback;

  if (progressCallback) {
    progressCallback("🔍 Performing quality check...");
    progressCallback(`🔍 Using model: ${state.quality_model}`);
  }

  const llm = createOpenRouterLLM(state.quality_model, apiKey);
  const structuredLLM = llm.withStructuredOutput(QualitySchema, {
    method: "jsonMode",
  });

  const qualityPrompt = PromptBuilder.buildQualityPrompt();
  const analysisText = JSON.stringify(state.analysis, null, 2);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", qualityPrompt],
    ["human", "{analysis_text}"],
  ]);

  const chain = prompt.pipe(structuredLLM);
  const quality = await chain.invoke({ analysis_text: analysisText });

  QualityUtils.printQualityBreakdown(quality);

  const percentageScore = QualityUtils.calculateScore(quality);
  const isComplete =
    percentageScore >= SUMMARY_CONFIG.MIN_QUALITY_SCORE ||
    state.iteration_count >= SUMMARY_CONFIG.MAX_ITERATIONS;

  return {
    quality: quality,
    is_complete: isComplete,
  };
}

/**
 * Conditional routing function
 */
function shouldContinue(state) {
  if (state.is_complete) {
    console.log("🔄 Workflow complete (is_complete=True)");
    return END;
  }

  const percentageScore = state.quality
    ? QualityUtils.calculateScore(state.quality)
    : 0;

  if (
    state.quality &&
    !QualityUtils.isAcceptable(state.quality) &&
    state.iteration_count < SUMMARY_CONFIG.MAX_ITERATIONS
  ) {
    console.log(
      `🔄 Quality ${percentageScore}% below threshold ${SUMMARY_CONFIG.MIN_QUALITY_SCORE}%, refining (iteration ${state.iteration_count + 1})`
    );
    return "analysisNode";
  }

  console.log(
    `🔄 Workflow ending (quality: ${percentageScore}%, iterations: ${state.iteration_count})`
  );
  return END;
}

// ============================================================================
// Graph Workflow
// ============================================================================

/**
 * Create and compile the summarization graph
 */
function createSummarizationGraph() {
  const workflow = new StateGraph(GraphStateSchema)
    .addNode("analysisNode", analysisNode)
    .addNode("qualityNode", qualityNode)
    .addEdge(START, "analysisNode")
    .addEdge("analysisNode", "qualityNode")
    .addConditionalEdges("qualityNode", shouldContinue, {
      analysisNode: "analysisNode",
      [END]: END,
    });

  return workflow.compile();
}

/**
 * Execute the summarization workflow
 * @param {Object} input - Workflow input
 * @param {string} input.transcript - Video transcript text
 * @param {string} input.analysis_model - Model for analysis (optional)
 * @param {string} input.quality_model - Model for quality check (optional)
 * @param {string} apiKey - OpenRouter API key
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Object>} Final workflow result
 */
async function executeSummarizationWorkflow(input, apiKey, progressCallback) {
  const graph = createSummarizationGraph();

  const initialState = {
    transcript: input.transcript,
    analysis_model: input.analysis_model || SUMMARY_CONFIG.ANALYSIS_MODEL,
    quality_model: input.quality_model || SUMMARY_CONFIG.QUALITY_MODEL,
    target_language: input.target_language || "auto",
    analysis: null,
    quality: null,
    iteration_count: 0,
    is_complete: false,
    apiKey: apiKey,
    progressCallback: progressCallback,
  };

  const result = await graph.invoke(initialState);

  // Build final output
  const percentageScore = result.quality
    ? QualityUtils.calculateScore(result.quality)
    : 0;

  // Format summary as markdown
  const summaryText = formatAnalysisAsMarkdown(result.analysis);

  return {
    analysis: result.analysis,
    quality: result.quality,
    iteration_count: result.iteration_count,
    quality_score: percentageScore,
    summary_text: summaryText,
  };
}

/**
 * Format analysis as markdown
 */
function formatAnalysisAsMarkdown(analysis) {
  const parts = [];

  // Summary
  parts.push("## Summary");
  parts.push("");
  parts.push(analysis.summary);
  parts.push("");

  // Takeaways
  if (analysis.takeaways && analysis.takeaways.length > 0) {
    parts.push("## Key Takeaways");
    parts.push("");
    analysis.takeaways.forEach((takeaway) => {
      parts.push(`- ${takeaway}`);
    });
    parts.push("");
  }

  // Key Facts
  if (analysis.key_facts && analysis.key_facts.length > 0) {
    parts.push("## Key Facts");
    parts.push("");
    analysis.key_facts.forEach((fact) => {
      parts.push(`- ${fact}`);
    });
    parts.push("");
  }

  return parts.join("\n");
}

// ES module exports for Node.js testing
export { executeSummarizationWorkflow, PromptBuilder, QualityUtils };
