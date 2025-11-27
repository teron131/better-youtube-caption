import { AnalysisSchema, QualitySchema } from "./schemas.js";

/**
 * Convert Zod schema to string representation for prompts
 * Similar to Python's schema_to_string function
 */
export function schemaToString(schema) {
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

export class PromptBuilder {
  // Language code to description mapping
  static LANGUAGE_DESCRIPTIONS = {
    "auto": "Use the same language as the transcript, or English if the transcript language is unclear",
    "en": "English (US)",
    "zh-TW": "Traditional Chinese (繁體中文)",
  };

  /**
   * Get language instruction text for a given language code
   * @param {string} targetLanguage - Language code (e.g., "auto", "en", "zh-TW")
   * @param {boolean} isRefinement - Whether this is for refinement (affects formatting)
   * @returns {string} Language instruction text
   */
  static _getLanguageInstruction(targetLanguage, isRefinement = false) {
    const prefix = isRefinement ? "\n\nOUTPUT LANGUAGE (REQUIRED): " : "- OUTPUT LANGUAGE (REQUIRED): ";
    const suffix = isRefinement ? " All text must be in this language." : "";
    
    const description = PromptBuilder.LANGUAGE_DESCRIPTIONS[targetLanguage] || targetLanguage;
    const instruction = targetLanguage === "auto" 
      ? description 
      : `Write ALL output (summary, takeaways, key_facts) in ${description}. Do not use English or any other language.`;
    
    return `${prefix}${instruction}${suffix}`;
  }

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
    const languageInstruction = PromptBuilder._getLanguageInstruction(targetLanguage, false);

    const promptParts = [
      "Create a comprehensive analysis that strictly follows the transcript content.",
      "",
      languageInstruction,
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

  static buildImprovementPrompt() {
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

