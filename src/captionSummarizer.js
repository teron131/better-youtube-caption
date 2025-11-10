/**
 * Summary Workflow using LangChain, LangGraph, and Zod
 * Implements analysis generation with quality verification and refinement loop
 */

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { END, START, StateGraph } from "@langchain/langgraph/web";
import { ChatOpenAI } from "@langchain/openai";
import * as z from "zod";

// ============================================================================
// Configuration
// ============================================================================

const SUMMARY_CONFIG = {
  ANALYSIS_MODEL: "x-ai/grok-4-fast",
  QUALITY_MODEL: "x-ai/grok-4-fast",
  MIN_QUALITY_SCORE: 90,
  MAX_ITERATIONS: 2,
};

// ============================================================================
// Zod Schemas (equivalent to Pydantic models)
// ============================================================================

const AnalysisSchema = z.object({
  summary: z
    .string()
    .describe("A comprehensive summary of the video content (150-400 words)"),
  takeaways: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe("Key insights and actionable takeaways for the audience"),
  key_facts: z
    .array(z.string())
    .min(3)
    .max(6)
    .describe("Important facts, statistics, or data points mentioned"),
});

const RateSchema = z.object({
  rate: z
    .enum(["Fail", "Refine", "Pass"])
    .describe(
      "Score for the quality aspect (Fail=poor, Refine=adequate, Pass=excellent)"
    ),
  reason: z.string().describe("Reason for the score"),
});

const QualitySchema = z.object({
  completeness: RateSchema.describe(
    "Rate for completeness: The entire transcript has been considered"
  ),
  accuracy: RateSchema.describe(
    "Rate for accuracy: Content directly supported by transcript (no external additions)"
  ),
  structure: RateSchema.describe(
    "Rate for structure: Summary, takeaways, and key_facts are properly formatted"
  ),
  grammar: RateSchema.describe(
    "Rate for grammar: No typos, grammatical mistakes, appropriate wordings"
  ),
  no_garbage: RateSchema.describe(
    "Rate for no_garbage: The promotional and meaningless content are removed"
  ),
});

// ============================================================================
// Schema to String Converter (equivalent to Python schema_to_string)
// ============================================================================

/**
 * Convert Zod schema to string representation for prompts
 * Similar to Python's schema_to_string function
 */
function schemaToString(schema) {
  function parseProperties(shape, defs = {}) {
    const lines = [];
    const refs = new Set();
    if (!shape || typeof shape !== "object") {
      return { lines, refs };
    }

    // Handle ZodObject
    if (shape._def && shape._def.shape) {
      const objectShape = shape._def.shape();
      for (const [fieldName, fieldSchema] of Object.entries(objectShape)) {
        const typeStr = typeString(fieldSchema, defs);
        const description = getDescription(fieldSchema);
        const constraints = getConstraints(fieldSchema);
        let line = `${fieldName}: ${typeStr}`;
        if (description) {
          line += ` = ${description}`;
        }
        if (constraints) {
          line += ` ${constraints}`;
        }
        lines.push(line);
      }
    }

    return { lines, refs };
  }

  function typeString(zodSchema, defs) {
    if (!zodSchema || !zodSchema._def) {
      return "Any";
    }

    const def = zodSchema._def;

    // Handle ZodString
    if (def.typeName === "ZodString") {
      return "str";
    }

    // Handle ZodNumber
    if (def.typeName === "ZodNumber") {
      return "float";
    }

    // Handle ZodBoolean
    if (def.typeName === "ZodBoolean") {
      return "bool";
    }

    // Handle ZodArray
    if (def.typeName === "ZodArray") {
      const itemType = typeString(def.type, defs);
      return `list[${itemType}]`;
    }

    // Handle ZodObject
    if (def.typeName === "ZodObject") {
      return "dict";
    }

    // Handle ZodEnum
    if (def.typeName === "ZodEnum") {
      const values = def.values;
      return `Literal[${values.map((v) => `"${v}"`).join(", ")}]`;
    }

    // Handle ZodOptional
    if (def.typeName === "ZodOptional") {
      return typeString(def.innerType, defs);
    }

    // Handle ZodDefault
    if (def.typeName === "ZodDefault") {
      return typeString(def.innerType, defs);
    }

    return "Any";
  }

  function getDescription(zodSchema) {
    if (!zodSchema || !zodSchema._def) {
      return null;
    }
    return zodSchema._def.description || null;
  }

  function getConstraints(zodSchema) {
    if (!zodSchema || !zodSchema._def) {
      return "";
    }

    const def = zodSchema._def;
    const constraints = [];

    // Array constraints
    if (def.typeName === "ZodArray") {
      if (def.minLength) {
        constraints.push(`minItems=${def.minLength.value}`);
      }
      if (def.maxLength) {
        constraints.push(`maxItems=${def.maxLength.value}`);
      }
    }

    // String constraints
    if (def.typeName === "ZodString") {
      if (def.minLength) {
        constraints.push(`minLength=${def.minLength.value}`);
      }
      if (def.maxLength) {
        constraints.push(`maxLength=${def.maxLength.value}`);
      }
    }

    return constraints.length > 0 ? `(${constraints.join(", ")})` : "";
  }

  const { lines } = parseProperties(schema);
  return lines.join("\n");
}

// ============================================================================
// Prompt Builder (using Zod schemas like Python uses Pydantic)
// ============================================================================

class PromptBuilder {
  /**
   * Extract field info from Zod schema (equivalent to Python's _extract_field_info)
   */
  static _extractFieldInfo(schema) {
    const fieldsInfo = {};
    if (schema._def && schema._def.shape) {
      const shape = schema._def.shape();
      for (const [fieldName, fieldSchema] of Object.entries(shape)) {
        const def = fieldSchema._def;
        fieldsInfo[fieldName] = {
          description: def.description || "",
          type: def.typeName,
          min_length:
            def.typeName === "ZodArray" ? def.minLength?.value : undefined,
          max_length:
            def.typeName === "ZodArray" ? def.maxLength?.value : undefined,
          required: true, // Zod doesn't have optional fields by default in this context
        };
      }
    }
    return fieldsInfo;
  }

  static _buildLengthSummary(fieldsInfo) {
    const parts = [];
    for (const [fieldName, info] of Object.entries(fieldsInfo)) {
      const displayName = fieldName.replace(/_/g, " ").replace(/\b\w/g, (l) =>
        l.toUpperCase()
      );
      const minLength = info.min_length;
      const maxLength = info.max_length;

      if (fieldName === "summary") {
        const desc = info.description || "";
        if (desc.includes("150-400 words") || desc.includes("(150-400 words)")) {
          parts.push("Summary (150-400 words)");
        } else {
          parts.push("Summary");
        }
      } else if (minLength !== undefined && maxLength !== undefined) {
        parts.push(`${displayName} (${minLength}-${maxLength} items)`);
      }
    }
    return parts.join(", ");
  }

  static _buildLengthGuidelines(fieldsInfo) {
    const lines = [];
    for (const [fieldName, info] of Object.entries(fieldsInfo)) {
      const displayName = fieldName.replace(/_/g, " ").replace(/\b\w/g, (l) =>
        l.toUpperCase()
      );
      const minLength = info.min_length;
      const maxLength = info.max_length;

      if (fieldName === "summary") {
        const desc = info.description || "";
        if (desc.includes("150-400 words") || desc.includes("(150-400 words)")) {
          lines.push("- Summary: 150-400 words");
        } else {
          lines.push("- Summary: As specified in description");
        }
      } else if (minLength !== undefined && maxLength !== undefined) {
        lines.push(`- ${displayName}: ${minLength}-${maxLength} items`);
      }
    }
    return lines;
  }

  static buildAnalysisPrompt(targetLanguage = "auto") {
    const schema = schemaToString(AnalysisSchema);
    const fieldsInfo = PromptBuilder._extractFieldInfo(AnalysisSchema);

    const fieldRequirements = [];
    for (const [fieldName, info] of Object.entries(fieldsInfo)) {
      if (!info.description) {
        continue;
      }

      const displayName = fieldName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

      let requirement = `- ${displayName}: ${info.description}`;
      const minLength = info.min_length;
      const maxLength = info.max_length;

      if (minLength !== undefined && maxLength !== undefined) {
        requirement += ` (${minLength}-${maxLength} items)`;
      }

      fieldRequirements.push(requirement);
    }

    // Build language instruction
    const languageInstruction = targetLanguage === "auto"
      ? "- OUTPUT LANGUAGE: Output in the same language as the transcript (auto-detect)"
      : `- OUTPUT LANGUAGE: Output must be in ${targetLanguage}`;

    const promptParts = [
      "Create a comprehensive analysis that strictly follows the transcript content.",
      "",
      "OUTPUT SCHEMA:",
      schema,
      "",
      "FIELD REQUIREMENTS:",
      fieldRequirements.join("\n"),
      "",
      "CORE REQUIREMENTS:",
      "- ACCURACY: Every claim must be directly supported by the transcript",
      "- TONE: Write in objective, article-like style (avoid 'This video...', 'The speaker...')",
      "- AVOID META-DESCRIPTIVE LANGUAGE: Do not use phrases like 'This analysis explores', etc. Write direct, factual content only",
      languageInstruction,
      "",
      "CONTENT FILTERING:",
      "- Remove all promotional content (speaker intros, calls-to-action, self-promotion)",
      "- Keep only educational content",
      "- Correct obvious typos naturally",
      "",
      "QUALITY CHECKS:",
      "- Content matches transcript exactly (no external additions)",
      "- All promotional content removed",
      "- Typos corrected naturally, meaning preserved",
      `- Length balanced: ${PromptBuilder._buildLengthSummary(fieldsInfo)}`,
    ];

    return promptParts.join("\n");
  }

  static buildQualityPrompt() {
    const schema = schemaToString(QualitySchema);
    const fieldsInfo = PromptBuilder._extractFieldInfo(QualitySchema);

    const aspectsLines = [];
    let idx = 1;
    for (const [fieldName, info] of Object.entries(fieldsInfo)) {
      const aspectName = fieldName.toUpperCase().replace(/_/g, " ");
      const desc = info.description || "";
      const description = desc.includes(":") ? desc.split(":", 2)[1].trim() : desc;
      aspectsLines.push(`${idx}. ${aspectName}: ${description}`);
      idx++;
    }

    // Build length guidelines from Analysis model
    const analysisFields = PromptBuilder._extractFieldInfo(AnalysisSchema);
    const lengthLines = PromptBuilder._buildLengthGuidelines(analysisFields);

    const promptParts = [
      "Evaluate the analysis on the following aspects. Rate each 'Fail', 'Refine', or 'Pass' with a specific reason.",
      "",
      "ASPECTS:",
      aspectsLines.join("\n"),
      "",
      "LENGTH GUIDELINES:",
      lengthLines.join("\n"),
      "",
      "QUALITY STANDARDS:",
      "- Transcript-based content only",
      "- Professional article-like tone",
      "",
      "Provide specific rates and reasons for each aspect.",
      "",
      "OUTPUT SCHEMA:",
      schema,
    ];

    return promptParts.join("\n");
  }

  static buildImprovementPrompt(targetLanguage = "auto") {
    const schema = schemaToString(AnalysisSchema);
    const fieldsInfo = PromptBuilder._extractFieldInfo(AnalysisSchema);

    const fieldRequirements = [];
    for (const [fieldName, info] of Object.entries(fieldsInfo)) {
      if (!info.description) {
        continue;
      }

      const displayName = fieldName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase());

      let requirement = `- ${displayName}: ${info.description}`;
      const minLength = info.min_length;
      const maxLength = info.max_length;

      if (minLength !== undefined && maxLength !== undefined) {
        requirement += ` (${minLength}-${maxLength} items)`;
      }

      fieldRequirements.push(requirement);
    }

    // Build language instruction
    const languageInstruction = targetLanguage === "auto"
      ? "7. OUTPUT LANGUAGE: Output in the same language as the transcript (auto-detect)"
      : `7. OUTPUT LANGUAGE: Output must be in ${targetLanguage}`;

    const promptParts = [
      "Improve the analysis based on quality feedback while maintaining transcript accuracy.",
      "",
      "IMPROVEMENT PRIORITIES:",
      "1. TRANSCRIPT ACCURACY: All content must be transcript-supported",
      "2. PROMOTIONAL REMOVAL: Remove all intros, calls-to-action, self-promotion",
      "3. WRITING STYLE: Use objective, article-like tone",
      "4. AVOID META-DESCRIPTIVE LANGUAGE: Remove phrases like 'This analysis explores', etc.",
      "5. TYPO CORRECTION: Fix obvious typos naturally",
      "6. ARRAY FORMATTING: Return takeaways/key_facts as simple string arrays",
      languageInstruction,
      "",
      "CONTENT TARGETS:",
      fieldRequirements.join("\n"),
      "",
      "OUTPUT SCHEMA:",
      schema,
    ];

    return promptParts.join("\n");
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

class QualityUtils {
  static calculateScore(quality) {
    const scoreMap = { Fail: 0, Refine: 1, Pass: 2 };
    const aspects = [
      quality.completeness,
      quality.accuracy,
      quality.structure,
      quality.grammar,
      quality.no_garbage,
    ];

    const totalScore = aspects.reduce(
      (sum, aspect) => sum + scoreMap[aspect.rate],
      0
    );
    const maxPossibleScore = aspects.length * 2;
    const percentageScore = Math.round((totalScore / maxPossibleScore) * 100);

    return percentageScore;
  }

  static isAcceptable(quality) {
    return (
      QualityUtils.calculateScore(quality) >= SUMMARY_CONFIG.MIN_QUALITY_SCORE
    );
  }

  static printQualityBreakdown(quality) {
    const score = QualityUtils.calculateScore(quality);
    console.log("📈 Quality breakdown:");
    console.log(
      `Completeness: ${quality.completeness.rate} - ${quality.completeness.reason}`
    );
    console.log(
      `Accuracy: ${quality.accuracy.rate} - ${quality.accuracy.reason}`
    );
    console.log(
      `Structure: ${quality.structure.rate} - ${quality.structure.reason}`
    );
    console.log(`Grammar: ${quality.grammar.rate} - ${quality.grammar.reason}`);
    console.log(
      `No Garbage: ${quality.no_garbage.rate} - ${quality.no_garbage.reason}`
    );
    console.log(`Total Score: ${score}%`);

    if (!QualityUtils.isAcceptable(quality)) {
      console.log(
        `⚠️  Quality below threshold (${SUMMARY_CONFIG.MIN_QUALITY_SCORE}%), refinement needed`
      );
    }
  }
}

// ============================================================================
// Graph State
// ============================================================================

const GraphStateSchema = z.object({
  transcript: z.string(),
  analysis_model: z.string().default(SUMMARY_CONFIG.ANALYSIS_MODEL),
  quality_model: z.string().default(SUMMARY_CONFIG.QUALITY_MODEL),
  analysis: AnalysisSchema.nullable().default(null),
  quality: QualitySchema.nullable().default(null),
  iteration_count: z.number().default(0),
  is_complete: z.boolean().default(false),
  // Internal state for API key and callback (not validated by Zod)
  apiKey: z.string().optional(),
  progressCallback: z.any().optional(),
  targetLanguage: z.string().default("auto"),
});

// ============================================================================
// Model Client
// ============================================================================

/**
 * Create OpenRouter LLM instance using LangChain
 */
function createOpenRouterLLM(model, apiKey) {
  const refererUrl =
    typeof chrome !== "undefined" && chrome.runtime
      ? chrome.runtime.getURL("")
      : "https://github.com/better-youtube-caption";

  return new ChatOpenAI({
    model: model,
    apiKey: apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": refererUrl,
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
  const targetLanguage = state.targetLanguage || "auto";

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
  let messages;

  // Refinement path
  if (state.quality && state.analysis) {
    const improvementContext = `# Improve this video analysis based on the following feedback:

## Analysis:

${JSON.stringify(state.analysis, null, 2)}

## Quality Assessment:

${JSON.stringify(state.quality, null, 2)}

Please provide an improved version that addresses the specific issues identified above to improve the overall quality score.`;

    const improvementSystemPrompt = PromptBuilder.buildImprovementPrompt(targetLanguage);
    const transcriptContext = `Original Transcript:\n${state.transcript}`;
    const fullImprovementPrompt = `${transcriptContext}\n\n${improvementContext}`;

    prompt = ChatPromptTemplate.fromMessages([
      ["system", improvementSystemPrompt],
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
    const analysisPrompt = PromptBuilder.buildAnalysisPrompt(targetLanguage);

    prompt = ChatPromptTemplate.fromMessages([
      ["system", analysisPrompt],
      ["human", "{content}"],
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
    analysis: null,
    quality: null,
    iteration_count: 0,
    is_complete: false,
    apiKey: apiKey,
    progressCallback: progressCallback,
    targetLanguage: input.targetLanguage || "auto",
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

// Export for use in background.js (service worker context)
// In bundled version, this will be available as SummaryWorkflow.executeSummarizationWorkflow
if (typeof globalThis !== "undefined") {
  globalThis.executeSummarizationWorkflow = executeSummarizationWorkflow;
  globalThis.SummaryWorkflow = {
    executeSummarizationWorkflow,
    PromptBuilder,
    QualityUtils,
  };
}

// ES module exports for Node.js testing
export { executeSummarizationWorkflow, PromptBuilder, QualityUtils };
