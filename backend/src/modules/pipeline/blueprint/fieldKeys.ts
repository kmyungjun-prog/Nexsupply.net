/**
 * Canonical field_key values for pipeline-generated claims.
 * Phase-D AI will reason over claims using these keys; do not rename without migration.
 */
export const FIELD_FACTORY_CANDIDATE = "factory_candidate";
export const FIELD_DOCUMENT_EXTRACTED = "document_extracted";
/** Phase-C+: rule-based flags attached to factory candidates (HYPOTHESIS, informational only). */
export const FIELD_FACTORY_RULE_FLAGS = "factory_rule_flags";
/** Phase-D: AI-generated explanation of rule flags only; no decisions/rankings. */
export const FIELD_FACTORY_AI_EXPLANATION = "factory_ai_explanation";
/** Phase-D+: AI-generated comparison of multiple candidates; explanation-only, no ranking. */
export const FIELD_FACTORY_AI_COMPARISON = "factory_ai_comparison";
/** Phase-E: execution plan (steps, assumptions); VERIFIED projects only; human approval required per step. */
export const FIELD_EXECUTION_PLAN = "execution_plan";
/** Phase-E: execution cost preview; VERIFIED projects only. */
export const FIELD_EXECUTION_COST_PREVIEW = "execution_cost_preview";
/** Phase-F: prepared execution artifact per approved step; requires_human_send, never auto-send. */
export const FIELD_EXECUTION_ACTION = "execution_action";
/** Phase-G: human-declared execution result with evidence; VERIFIED claim, append-only. */
export const FIELD_EXECUTION_ACTION_RESULT = "execution_action_result";
/** Phase-H: repeat-SKU automation eligibility (guardrails only; no automatic execution). */
export const FIELD_AUTOMATION_ELIGIBILITY = "automation_eligibility";
