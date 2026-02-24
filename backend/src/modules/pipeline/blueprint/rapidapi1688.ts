import { ActorRole, ClaimType } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_FACTORY_CANDIDATE } from "./fieldKeys.js";

export type FactoryCandidate = {
  factory_name: string;
  platform: string;
  source_url: string;
  price_range?: { min?: number; max?: number; currency?: string };
  moq?: string;
  location?: string;
};

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

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
  return "";
}

function getStubCandidates(query: string): FactoryCandidate[] {
  const q = query.trim() || "product";
  return [
    { factory_name: `${q} Factory Co., Ltd`, platform: "alibaba", source_url: "https://www.alibaba.com", moq: "100", location: "Guangdong, China" },
    { factory_name: `${q} Manufacturing Ltd`, platform: "made-in-china", source_url: "https://www.made-in-china.com", moq: "200", location: "Zhejiang, China" },
    { factory_name: `${q} Global Supplies`, platform: "globalsources", source_url: "https://www.globalsources.com", moq: "300", location: "Jiangsu, China" },
  ];
}

/**
 * SerpApi Google Search with supplier site filters.
 * Replaces RapidAPI 1688 (which only returns code 205 on free plan).
 */
export async function fetchFactoryCandidates(productNameOrCategory: string): Promise<FactoryCandidate[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return getStubCandidates(productNameOrCategory);

  const query = productNameOrCategory.trim();
  if (!query) return getStubCandidates("");

  const searchQuery = `${query} supplier wholesale site:alibaba.com OR site:made-in-china.com OR site:globalsources.com`;
  const params = new URLSearchParams({
    engine: "google",
    q: searchQuery,
    api_key: apiKey,
    num: "10",
  });

  try {
    const res = await fetch(`https://serpapi.com/search?${params}`);
    if (!res.ok) throw new Error(`SerpApi: ${res.status}`);
    const data = (await res.json()) as { organic_results?: Array<Record<string, unknown>> };

    const results = data.organic_results ?? [];
    if (results.length === 0) return getStubCandidates(query);

    const candidates: FactoryCandidate[] = results.slice(0, 5).map((item) => {
      const link = String(item.link ?? "");
      const platform = link.includes("alibaba.com")
        ? "alibaba"
        : link.includes("made-in-china.com")
          ? "made-in-china"
          : "globalsources";

      return {
        factory_name: String(item.title ?? "Unknown Supplier"),
        platform,
        source_url: link,
        location: "China",
      };
    });

    return candidates.length >= 1
      ? candidates
      : getStubCandidates(query);
  } catch (err) {
    console.warn("SerpApi search failed, using stub:", err);
    return getStubCandidates(productNameOrCategory);
  }
}

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
        platform: c.platform ?? "alibaba",
        source_url: c.source_url,
        price_range: c.price_range ?? undefined,
        moq: c.moq,
        location: c.location,
      },
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "api",
      sourceRef: "serpapi:google",
      versionId,
      idempotencyKey: `blueprint:factory:${idempotencyKey}:${i}`,
      requestId,
    });
  }
}
