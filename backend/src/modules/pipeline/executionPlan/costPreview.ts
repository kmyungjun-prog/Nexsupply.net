/**
 * Phase-E: Execution cost preview (deterministic).
 * Formula: estimated_execution_fee = max(FOB_Total * 0.10, 500).
 * Reads from verified snapshot when available; otherwise uses placeholder.
 *
 * TODO: Phase-F execution automation (charges applied on executed actions).
 * TODO: UI action wiring (display preview, confirm before order).
 * TODO: Localization (notes, currency).
 */

export type ExecutionCostPreviewValueJson = {
  estimated_fob_total: number;
  estimated_execution_fee: number;
  calculation_basis: string;
  notes: string;
};

const FEE_RATE = 0.1;
const MIN_FEE = 500;
const CALCULATION_BASIS = "max(FOB_Total * 0.10, 500)";
const NOTES = "Preview only. Final charges depend on executed actions.";

/** Build execution cost preview value_json from snapshot or placeholder. */
export function buildExecutionCostPreviewValue(snapshot: unknown): ExecutionCostPreviewValueJson {
  let fobTotal = 0;
  if (snapshot != null && typeof snapshot === "object" && "assumptions" in snapshot) {
    const assumptions = (snapshot as { assumptions?: { fob_total?: number } }).assumptions;
    if (typeof assumptions?.fob_total === "number" && assumptions.fob_total >= 0) {
      fobTotal = assumptions.fob_total;
    }
  }

  const estimatedExecutionFee = Math.max(fobTotal * FEE_RATE, MIN_FEE);

  return {
    estimated_fob_total: fobTotal,
    estimated_execution_fee: estimatedExecutionFee,
    calculation_basis: CALCULATION_BASIS,
    notes: NOTES,
  };
}
