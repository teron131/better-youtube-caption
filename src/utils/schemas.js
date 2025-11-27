import * as z from "zod";

export const AnalysisSchema = z.object({
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

export const RateSchema = z.object({
  rate: z
    .enum(["Fail", "Refine", "Pass"])
    .describe(
      "Score for the quality aspect (Fail=poor, Refine=adequate, Pass=excellent)"
    ),
  reason: z.string().describe("Reason for the score"),
});

export const QualitySchema = z.object({
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

export const GraphStateSchema = z.object({
  transcript: z.string(),
  analysis_model: z.string().optional(),
  quality_model: z.string().optional(),
  target_language: z.string().default("auto"),
  analysis: AnalysisSchema.nullable().default(null),
  quality: QualitySchema.nullable().default(null),
  iteration_count: z.number().default(0),
  is_complete: z.boolean().default(false),
  // Internal state for API key and callback (not validated by Zod)
  apiKey: z.string().optional(),
  progressCallback: z.any().optional(),
});

