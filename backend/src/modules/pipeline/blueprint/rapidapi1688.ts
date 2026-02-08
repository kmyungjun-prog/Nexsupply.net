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
 * 우선순위: Gemini search_keywords_1688[0] > product_name_zh > product_name > legacy fields.
 */
export async function getProductOrCategoryFromProject(projectId: string): Promise<string> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { resolvedViewJsonb: true },
  });
  const view = project?.resolvedViewJsonb as Record<string, unknown> | null | undefined;
  if (!view || typeof view !== "object") return "";

  if (Array.isArray(view.search_keywords_1688) && view.search_keywords_1688.length > 0) {
    return String(view.search_keywords_1688[0]);
  }
  if (view.product_name_zh && typeof view.product_name_zh === "string") return view.product_name_zh;
  if (view.product_name && typeof view.product_name === "string") return view.product_name;
  if (view.category && typeof view.category === "string") return view.category;

  const fields = (view.fields ?? {}) as Record<string, { value?: unknown }>;
  const product = (fields.product_name ?? fields.product_name_hypothesis ?? fields.category ?? { value: "" }) as { value?: string };
  return typeof product?.value === "string" ? product.value : "";
}

function getStubCandidates(query: string): FactoryCandidate[] {
  const q = query.trim() || "product";
  return [
    { factory_name: `Stub ${q} 1`, platform: "1688", source_url: "https://example.com/1", moq: "100", location: "Guangdong" },
    { factory_name: `Stub ${q} 2`, platform: "1688", source_url: "https://example.com/2", moq: "200", location: "Zhejiang" },
    { factory_name: `Stub ${q} 3`, platform: "1688", source_url: "https://example.com/3", moq: "300", location: "Jiangsu" },
  ];
}

function parseItemToCandidate(item: Record<string, unknown>): FactoryCandidate {
  const price = item.price ?? item.minPrice;
  const priceNum = typeof price === "number" ? price : typeof price === "string" ? parseFloat(price) : 0;
  const priceRange = item.priceRange as [number, number] | undefined;
  const min = priceRange?.[0] ?? priceNum;
  const max = priceRange?.[1] ?? priceNum;
  const link = (item.detailUrl ?? item.offerUrl ?? item.url) as string | undefined;
  const url =
    link && link !== "undefined"
      ? link
      : item.offerId
        ? `https://detail.1688.com/offer/${item.offerId}.html`
        : "https://www.1688.com";
  const moqRaw = item.quantityBegin ?? item.moq ?? item.minOrder;
  const moq =
    typeof moqRaw === "string" ? moqRaw : moqRaw != null && typeof moqRaw !== "object" ? String(moqRaw) : undefined;
  return {
    factory_name: String(item.companyName ?? item.shopName ?? item.sellerName ?? item.title ?? "Unknown"),
    platform: "1688",
    source_url: url,
    price_range: { min: Number(min) || undefined, max: Number(max) || undefined, currency: "CNY" },
    moq,
    location: String(item.province ?? item.city ?? item.location ?? "China"),
  };
}

/**
 * Call RapidAPI 1688 (or stub). Uses RAPIDAPI_KEY and RAPIDAPI_HOST from process.env.
 * API 실패 시 stub fallback으로 서비스 중단 방지.
 */
export async function fetchFactoryCandidates(productNameOrCategory: string): Promise<FactoryCandidate[]> {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST;
  if (!key || !host) return getStubCandidates(productNameOrCategory);

  const query = productNameOrCategory.trim();
  if (!query) return getStubCandidates("");

  // 1688-datahub 등: 호스트별로 경로/파라미터가 다를 수 있음 (keyword 또는 query)
  const encoded = encodeURIComponent(query);
  const url = `https://${host}/search?keyword=${encoded}&page=1`;
  try {
    const res = await fetch(url, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host },
    });
    if (!res.ok) throw new Error(`1688 API: ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;
    const rawList =
      (data.result as { result?: unknown[] })?.result ??
      (data.data as unknown[]) ??
      (data.items as unknown[]) ??
      (data.results as unknown[]) ??
      [];
    const items = Array.isArray(rawList) ? rawList : [];
    const candidates = items.slice(0, 10).map((it) => parseItemToCandidate((it as Record<string, unknown>) ?? {}));
    if (candidates.length >= 3) return candidates;
    return [...candidates, ...getStubCandidates(query).slice(0, Math.max(0, 3 - candidates.length))];
  } catch (err) {
    console.warn("1688 API failed, using stub:", err);
    return getStubCandidates(productNameOrCategory);
  }
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
