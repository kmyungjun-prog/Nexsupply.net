/**
 * Phase-E: Deterministic execution plan generation.
 * Reads from verified_snapshot_jsonb and verified_version_id only.
 * Does not create VERIFIED claims; does not alter snapshot.
 *
 * TODO: Phase-F execution automation (steps remain human-approved).
 * TODO: UI action wiring (step → confirm / reject).
 * TODO: Localization (descriptions, risks).
 */

import type { ExecutionPlanStep } from "./safeguards.js";
import { assertAllStepsRequireHuman } from "./safeguards.js";

export type ExecutionPlanValueJson = {
  version_id: string;
  assumptions: {
    order_quantity: number | null;
    incoterm: string;
    currency: string;
  };
  steps: ExecutionPlanStep[];
  risks_to_confirm: string[];
  generated_at: string;
};

const DEFAULT_STEPS: ExecutionPlanStep[] = [
  {
    step: "sample_request",
    description: "Request pre-production sample from the verified factory",
    inputs_required: ["shipping_address", "sample_quantity"],
    human_action_required: true,
  },
  {
    step: "price_confirmation",
    description: "Confirm final unit price, MOQ, and payment terms",
    inputs_required: [],
    human_action_required: true,
  },
  {
    step: "production_lead_time",
    description: "Confirm production timeline and shipping window",
    inputs_required: [],
    human_action_required: true,
  },
];

const DEFAULT_RISKS = [
  "Lead time variance",
  "Payment terms",
  "Packaging requirements",
];

/** Build execution plan value_json. Uses snapshot for order_quantity if present; otherwise placeholder. */
export function buildExecutionPlanValue(verifiedVersionId: string, snapshot: unknown): ExecutionPlanValueJson {
  assertAllStepsRequireHuman(DEFAULT_STEPS);

  let orderQuantity: number | null = null;
  if (snapshot != null && typeof snapshot === "object" && "assumptions" in snapshot) {
    const assumptions = (snapshot as { assumptions?: { order_quantity?: number } }).assumptions;
    if (typeof assumptions?.order_quantity === "number") {
      orderQuantity = assumptions.order_quantity;
    }
  }

  return {
    version_id: verifiedVersionId,
    assumptions: {
      order_quantity: orderQuantity,
      incoterm: "FOB",
      currency: "USD",
    },
    steps: [...DEFAULT_STEPS],
    risks_to_confirm: [...DEFAULT_RISKS],
    generated_at: new Date().toISOString(),
  };
}
