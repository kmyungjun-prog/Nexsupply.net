/**
 * DTOs for internal Blueprint Review API (Phase-E/F/G).
 * Read-only responses; no edit/delete.
 */

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
  /** True if an execution_approved audit already exists for this project (idempotent; disable Approve button). */
  hasExecutionApproved: boolean;
  claims: {
    factory_candidate: ClaimSummary[];
    factory_rule_flags: ClaimSummary[];
    factory_ai_explanation: ClaimSummary[];
    execution_plan: ClaimSummary[];
    execution_cost_preview: ClaimSummary[];
    execution_action: ClaimSummary[];
    execution_action_result: ClaimSummary[];
    automation_eligibility: ClaimSummary[];
  };
};

export type ApproveExecutionBody = {
  approved_steps: string[];
};

export type ApproveExecutionResponse = {
  ok: boolean;
  message: string;
  replayed?: boolean;
};

export type MarkSentBody = {
  step: string;
  evidence_ids: string[];
};

export type MarkSentResponse = {
  ok: boolean;
  message: string;
  step?: string;
  alreadyRecorded?: boolean;
};

/** Evidence list item (append-only; no delete/edit). Includes virus_scan_status per SOW. */
export type EvidenceListItem = {
  evidence_id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  uploaded_by: string;
  virus_scan_status: string;
};

export type EvidenceInitiateBody = {
  original_filename: string;
  mime_type: string;
  size_bytes?: number;
  sha256?: string;
};

export type EvidenceInitiateResponse = {
  upload_url: string;
  upload_headers?: Record<string, string>;
  gcs_path: string;
  upload_expires_at: string;
};

export type EvidenceCompleteBody = {
  gcs_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256?: string;
};

export type EvidenceCompleteResponse = {
  evidence_id: string;
  gcs_path: string;
};
