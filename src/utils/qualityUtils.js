const SCORE_MAP = { Fail: 0, Refine: 1, Pass: 2 };
const MAX_SCORE_PER_ASPECT = 2;

export const SUMMARY_CONFIG = {
  ANALYSIS_MODEL: "x-ai/grok-4-fast",
  QUALITY_MODEL: "x-ai/grok-4-fast",
  MIN_QUALITY_SCORE: 90,
  MAX_ITERATIONS: 2,
};

/**
 * Calculate percentage quality score from quality assessment
 */
function calculateScore(quality) {
  const aspects = [
    quality.completeness,
    quality.accuracy,
    quality.structure,
    quality.grammar,
    quality.no_garbage,
  ];

  const totalScore = aspects.reduce((sum, aspect) => sum + SCORE_MAP[aspect.rate], 0);
  const maxPossibleScore = aspects.length * MAX_SCORE_PER_ASPECT;

  return Math.round((totalScore / maxPossibleScore) * 100);
}

/**
 * Check if quality score meets minimum threshold
 */
function isAcceptable(quality) {
  return calculateScore(quality) >= SUMMARY_CONFIG.MIN_QUALITY_SCORE;
}

/**
 * Log detailed quality breakdown to console
 */
function printQualityBreakdown(quality) {
  const score = calculateScore(quality);

  console.log("📈 Quality breakdown:");
  console.log(`Completeness: ${quality.completeness.rate} - ${quality.completeness.reason}`);
  console.log(`Accuracy: ${quality.accuracy.rate} - ${quality.accuracy.reason}`);
  console.log(`Structure: ${quality.structure.rate} - ${quality.structure.reason}`);
  console.log(`Grammar: ${quality.grammar.rate} - ${quality.grammar.reason}`);
  console.log(`No Garbage: ${quality.no_garbage.rate} - ${quality.no_garbage.reason}`);
  console.log(`Total Score: ${score}%`);

  if (!isAcceptable(quality)) {
    console.log(`⚠️  Quality below threshold (${SUMMARY_CONFIG.MIN_QUALITY_SCORE}%), refinement needed`);
  }
}

export class QualityUtils {
  static calculateScore = calculateScore;
  static isAcceptable = isAcceptable;
  static printQualityBreakdown = printQualityBreakdown;
}
