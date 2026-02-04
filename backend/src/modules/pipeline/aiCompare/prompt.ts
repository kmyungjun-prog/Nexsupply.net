/**
 * Phase-D+: Deterministic, comparison-only prompts.
 * Hard constraint: no rank, score, recommend, or judge.
 *
 * TODO: User-selected comparison groups (e.g. user picks which candidates to compare).
 * TODO: Localization (language per project/locale).
 * TODO: Phase-E execution planning (comparison as input to execution flow).
 */

export function getSystemPrompt(): string {
  return (
    "You explain similarities and differences across multiple factory candidates. " +
    "Do not rank, score, recommend, or judge. " +
    "Do not say which option is better."
  );
}

export function getUserPrompt(candidatesJson: string, flagsJson: string): string {
  return (
    `Factory candidates:\n${candidatesJson}\n\n` +
    `Applied rule flags:\n${flagsJson}\n\n` +
    "Explain:\n" +
    "1) Common characteristics shared by these candidates\n" +
    "2) Key differences, described neutrally per candidate\n\n" +
    "Do not suggest actions, preferences, or conclusions.\n\n" +
    "Respond with valid JSON only, no other text. Format:\n" +
    '{"common_points": ["string", ...], "differences": [{"factory_candidate_id": "uuid", "notes": ["string", ...]}]}'
  );
}
