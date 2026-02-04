/**
 * Phase-D: Deterministic, explanation-only prompts.
 * Hard constraint: no judgments, recommendations, or rankings.
 *
 * TODO: Multi-candidate comparison (still explanation-only; no ranking).
 * TODO: Localization (language per project/locale).
 * TODO: Phase-E execution planning (explanation as input to execution flow).
 */

export function getSystemPrompt(): string {
  return (
    "You are an assistant that explains rule-based flags applied to factory data. " +
    "Do not make judgments, recommendations, or rankings. " +
    "Explain only why the flags were triggered based on the given data."
  );
}

export function getUserPrompt(factoryCandidateJson: string, factoryRuleFlagsJson: string): string {
  return (
    `Factory data:\n${factoryCandidateJson}\n\n` +
    `Applied rule flags:\n${factoryRuleFlagsJson}\n\n` +
    "Explain, in neutral language, why these flags were triggered. Do not suggest actions or preferences."
  );
}
