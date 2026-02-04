import { ActorRole, ClaimType } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_FACTORY_CANDIDATE } from "./fieldKeys.js";

/** Factory candidate shape for 1688 / RapidAPI. TODO: ranking logic — no auto-selection; auditor approval required. */
export type FactoryCandidate = {
  factory_name: string;
  platform: string;
  source_url: string;
  price_range?: { min?: number; max?: number; currency?: string };
  moq?: string;
  location?: string;
};

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

/**
 * Get product name or category from existing H claims / resolved view.
 */
export async function getProductOrCategoryFromProject(projectId: string): Promise<string> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { resolvedViewJsonb: true },
  });
  if (!project?.resolvedViewJsonb || typeof project.resolvedViewJsonb !== "object") {
    return "";
  }
  const view = project.resolvedViewJsonb as { fields?: Record<string, { value?: unknown }> };
  const fields = view.fields ?? {};
  const product = (fields.product_name ?? fields.product_name_hypothesis ?? fields.category ?? { value: "" }) as { value?: string };
  return typeof product?.value === "string" ? product.value : "";
}

/**
 * Call RapidAPI 1688 (or stub). Uses RAPIDAPI_KEY and RAPIDAPI_HOST from process.env.
 * Returns at least 3 candidates when available.
 */
export async function fetchFactoryCandidates(productNameOrCategory: string): Promise<FactoryCandidate[]> {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  if (!key || !host) {
    // Stub: return minimal candidates for dev. TODO: wire real RapidAPI 1688 endpoint.
    if (!productNameOrCategory.trim()) {
      return [
        { factory_name: "Stub Factory A", platform: "1688", source_url: "https://example.com/a", moq: "100", location: "Guangdong" },
        { factory_name: "Stub Factory B", platform: "1688", source_url: "https://example.com/b", moq: "500", location: "Zhejiang" },
        { factory_name: "Stub Factory C", platform: "1688", source_url: "https://example.com/c", moq: "200", location: "Jiangsu" },
      ];
    }
    return [
      { factory_name: `Stub ${productNameOrCategory} 1`, platform: "1688", source_url: "https://example.com/1", moq: "100", location: "Guangdong" },
      { factory_name: `Stub ${productNameOrCategory} 2`, platform: "1688", source_url: "https://example.com/2", moq: "200", location: "Zhejiang" },
      { factory_name: `Stub ${productNameOrCategory} 3`, platform: "1688", source_url: "https://example.com/3", moq: "300", location: "Jiangsu" },
    ];
  }

  // TODO: call real RapidAPI 1688 (exact path depends on API; e.g. /search or /suppliers)
  const url = `https://${host}/search?query=${encodeURIComponent(productNameOrCategory)}`;
  const res = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": host,
    },
  });
  if (!res.ok) {
    throw new Error(`RapidAPI error: ${res.status}`);
  }
  const data = (await res.json()) as { results?: FactoryCandidate[]; data?: FactoryCandidate[] };
  const list = data.results ?? data.data ?? [];
  const candidates = Array.isArray(list) ? list.slice(0, 10) : [];
  if (candidates.length >= 3) return candidates;
  const stub: FactoryCandidate[] = [
    { factory_name: "Stub A", platform: "1688", source_url: "https://example.com/a", moq: "100", location: "Guangdong" },
    { factory_name: "Stub B", platform: "1688", source_url: "https://example.com/b", moq: "200", location: "Zhejiang" },
    { factory_name: "Stub C", platform: "1688", source_url: "https://example.com/c", moq: "300", location: "Jiangsu" },
  ];
  return [...candidates, ...stub.slice(0, Math.max(0, 3 - candidates.length))];
}

/**
 * Create sourcing_claims for each candidate (HYPOTHESIS only). Full audit logging.
 */
export async function createFactoryCandidateClaims(
  projectId: string,
  versionId: string,
  idempotencyKey: string,
  candidates: FactoryCandidate[],
  requestId: string,
): Promise<void> {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_FACTORY_CANDIDATE,
      valueJson: {
        factory_name: c.factory_name,
        platform: c.platform ?? "1688",
        source_url: c.source_url,
        price_range: c.price_range ?? undefined,
        moq: c.moq,
        location: c.location,
      },
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "api",
      sourceRef: "rapidapi:1688",
      versionId,
      idempotencyKey: `blueprint:factory:${idempotencyKey}:${i}`,
      requestId,
    });
  }
}
