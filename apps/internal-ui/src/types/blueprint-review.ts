export type BlueprintReviewProject = {
  id: string;
  status: string;
  verifiedSnapshotJsonb: unknown;
  verifiedVersionId: string | null;
};

export type ClaimSummary = {
  id: string;
  fieldKey: string;
  claimType: string;
  valueJson: unknown;
  createdAt: string;
};

export type BlueprintReviewResponse = {
  project: BlueprintReviewProject;
  hasExecutionApproved: boolean;
  claims: {
    factory_candidate: ClaimSummary[];
    factory_rule_flags: ClaimSummary[];
    factory_ai_explanation: ClaimSummary[];
    execution_plan: ClaimSummary[];
    execution_cost_preview: ClaimSummary[];
    execution_action: ClaimSummary[];
    execution_action_result: ClaimSummary[];
  };
};
