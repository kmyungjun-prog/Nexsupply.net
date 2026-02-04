/**
 * Canonical price_mid for factory_candidate price_range.
 * Phase-D AI should reuse this same definition for consistency.
 *
 * Formula: (min + max) / 2 when both present; else min ?? max ?? null.
 */
export type PriceRange = { min?: number; max?: number; currency?: string };

export function getPriceMid(priceRange: PriceRange | null | undefined): number | null {
  if (!priceRange) return null;
  const min =
    typeof priceRange.min === "number" && Number.isFinite(priceRange.min) ? priceRange.min : null;
  const max =
    typeof priceRange.max === "number" && Number.isFinite(priceRange.max) ? priceRange.max : null;
  if (min != null && max != null) return (min + max) / 2;
  if (min != null) return min;
  if (max != null) return max;
  return null;
}
