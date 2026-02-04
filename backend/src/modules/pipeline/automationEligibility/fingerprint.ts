/**
 * Phase-H: Deterministic SKU fingerprint for repeat-SKU matching.
 * Same snapshot → same fingerprint. Pure function.
 */

import { createHash } from "node:crypto";

/** Minimal snapshot shape for fingerprint; extend as resolved view schema evolves. */
export type SnapshotForFingerprint = {
  product_category?: string | null;
  material?: string | null;
  specs?: string | null;
};

function safeString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return "";
}

/**
 * Deterministic SKU fingerprint: hash(product_category + material + specs).
 * Same snapshot → same fingerprint.
 */
export function skuFingerprint(snapshot: unknown): string {
  const s = snapshot as SnapshotForFingerprint | null | undefined;
  const cat = safeString(s?.product_category);
  const mat = safeString(s?.material);
  const spec = safeString(s?.specs);
  const payload = `${cat}|${mat}|${spec}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
