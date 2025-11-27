export const SUMMARY_CONFIG = {
  ANALYSIS_MODEL: "x-ai/grok-4-fast",
  QUALITY_MODEL: "x-ai/grok-4-fast",
  MIN_QUALITY_SCORE: 90,
  MAX_ITERATIONS: 2,
};

export class QualityUtils {
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

