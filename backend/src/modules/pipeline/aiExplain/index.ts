/**
 * Phase-D: AI-powered explanation layer. Explains rule flags only; no decisions, scores, or rankings.
 */

export { runAiExplain } from "./explain.js";
export { getSystemPrompt, getUserPrompt } from "./prompt.js";
export {
  assertProjectNotVerified,
  sanitizeExplanation,
  FORBIDDEN_PHRASES,
  MIN_EXPLANATION_LENGTH,
} from "./safeguards.js";
export { generateContent, getModelVersion, DEFAULT_MODEL } from "./vertexGemini.js";
