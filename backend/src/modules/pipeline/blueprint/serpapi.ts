/**
 * SerpApi-based full sourcing journey: Lens, factories, forwarders, customs, inland.
 */

import type { FactoryCandidate } from "./rapidapi1688.js";
import { fetchFactoryCandidates } from "./rapidapi1688.js";

const SERPAPI_BASE = "https://serpapi.com/search";

export type QcHub = {
  name: string;
  location: string;
  source_url: string;
  services: string;
};

export type Forwarder = {
  name: string;
  source_url: string;
  origin_city: string;
  services: string;
};

export type CustomsInfo = {
  hs_code_hint: string;
  destination_port: string;
  required_docs: string[];
  source_urls: string[];
};

export type InlandOption = {
  name: string;
  type: string;
  source_url: string;
};

export type SourcingJourney = {
  step1_sourcing: FactoryCandidate[];
  step2_qc_packaging: QcHub[];
  step3_forwarding: Forwarder[];
  step4_customs: CustomsInfo;
  step5_inland: InlandOption[];
};

function getStubCandidates(query: string): FactoryCandidate[] {
  const q = query.trim() || "product";
  return [
    { factory_name: `${q} Factory Co., Ltd`, platform: "alibaba", source_url: "https://www.alibaba.com", moq: "100", location: "Guangdong, China" },
    { factory_name: `${q} Manufacturing Ltd`, platform: "made-in-china", source_url: "https://www.made-in-china.com", moq: "200", location: "Zhejiang, China" },
    { factory_name: `${q} Global Supplies`, platform: "globalsources", source_url: "https://www.globalsources.com", moq: "300", location: "Jiangsu, China" },
  ];
}

async function searchByImageLens(imageUrl: string, apiKey: string | undefined): Promise<FactoryCandidate[]> {
  if (!apiKey) return [];
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
  });
  try {
    const res = await fetch(`${SERPAPI_BASE}?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      visual_matches?: Array<{ title?: string; link?: string; source?: string }>;
      products?: Array<{ title?: string; link?: string }>;
    };
    const matches = [...(data.visual_matches ?? []), ...(data.products ?? [])];
    return matches.slice(0, 5).map((r) => ({
      factory_name: String(r.title ?? "Supplier"),
      platform: "google_lens",
      source_url: String(r.link ?? ""),
      location: "China",
    }));
  } catch {
    return [];
  }
}

async function searchByKeyword(keyword: string): Promise<FactoryCandidate[]> {
  return fetchFactoryCandidates(keyword);
}

async function searchForwarders(
  originCity: string,
  destinationCity: string,
  apiKey: string | undefined
): Promise<Forwarder[]> {
  if (!apiKey) return getStubForwarders(originCity);

  const params = new URLSearchParams({
    engine: "google",
    q: `freight forwarder ${originCity} China to ${destinationCity} shipping agent`,
    api_key: apiKey,
    num: "5",
  });

  try {
    const res = await fetch(`${SERPAPI_BASE}?${params}`);
    if (!res.ok) return getStubForwarders(originCity);
    const data = (await res.json()) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
    return (data.organic_results ?? []).slice(0, 4).map((r) => ({
      name: r.title ?? "Freight Forwarder",
      source_url: r.link ?? "",
      origin_city: originCity,
      services: r.snippet?.slice(0, 100) ?? "International freight forwarding",
    }));
  } catch {
    return getStubForwarders(originCity);
  }
}

async function searchInlandLogistics(destinationCity: string, apiKey: string | undefined): Promise<InlandOption[]> {
  if (!apiKey) return getStubInland(destinationCity);

  const params = new URLSearchParams({
    engine: "google",
    q: `customs broker import logistics ${destinationCity} China goods delivery`,
    api_key: apiKey,
    num: "5",
  });

  try {
    const res = await fetch(`${SERPAPI_BASE}?${params}`);
    if (!res.ok) return getStubInland(destinationCity);
    const data = (await res.json()) as { organic_results?: Array<{ title?: string; link?: string }> };
    return (data.organic_results ?? []).slice(0, 3).map((r) => ({
      name: r.title ?? "Logistics Provider",
      type: "customs_broker",
      source_url: r.link ?? "",
    }));
  } catch {
    return getStubInland(destinationCity);
  }
}

function getQcHubs(region: string): QcHub[] {
  return [
    { name: "QIMA (Global QC)", location: region, source_url: "https://www.qima.com", services: "Product inspection, factory audit, lab testing" },
    { name: "Bureau Veritas", location: region, source_url: "https://www.bureauveritas.com", services: "QC inspection, certification" },
    { name: "SGS Group", location: region, source_url: "https://www.sgs.com", services: "Testing, inspection, certification" },
  ];
}

function buildCustomsInfo(hsCodeHint: string, destinationCity: string): CustomsInfo {
  const portMap: Record<string, string> = {
    "new york": "Port of New York/New Jersey",
    "los angeles": "Port of Los Angeles",
    chicago: "O'Hare / Chicago Rail",
    london: "Port of Felixstowe",
    seoul: "Incheon Port",
    tokyo: "Port of Tokyo",
  };
  const cityKey = destinationCity.toLowerCase();
  const port = Object.entries(portMap).find(([k]) => cityKey.includes(k))?.[1] ?? `Main port near ${destinationCity}`;

  return {
    hs_code_hint: hsCodeHint,
    destination_port: port,
    required_docs: ["Commercial Invoice", "Packing List", "Bill of Lading", "Certificate of Origin"],
    source_urls: ["https://hts.usitc.gov", "https://www.cbp.gov/trade/basic-import-export"],
  };
}

function getStubForwarders(origin: string): Forwarder[] {
  return [
    { name: "Flexport", source_url: "https://www.flexport.com", origin_city: origin, services: "Full-service freight forwarding, customs brokerage" },
    { name: "Freightos", source_url: "https://www.freightos.com", origin_city: origin, services: "Online freight marketplace, instant quotes" },
    { name: "Sinotrans", source_url: "https://www.sinotrans.com", origin_city: origin, services: "China-based freight, door-to-door" },
  ];
}

function getStubInland(_destination: string): InlandOption[] {
  return [
    { name: "UPS Supply Chain", type: "trucking", source_url: "https://www.ups.com/us/en/supplychain" },
    { name: "Customs City (broker finder)", type: "customs_broker", source_url: "https://www.customscity.com" },
  ];
}

/**
 * Full parallel sourcing journey search.
 */
export async function fetchFullSourcingJourney(params: {
  imageUrl: string;
  keyword: string;
  sourcingRegion: string;
  destinationCity: string;
  shippingMethod: string;
  hintHsCode: string;
}): Promise<SourcingJourney> {
  const apiKey = process.env.SERPAPI_KEY;

  const [lensResults, factories, forwarders, inland] = await Promise.all([
    searchByImageLens(params.imageUrl, apiKey),
    searchByKeyword(params.keyword).catch(() => [] as FactoryCandidate[]),
    searchForwarders(params.sourcingRegion, params.destinationCity, apiKey),
    searchInlandLogistics(params.destinationCity, apiKey),
  ]);

  const allFactories = [...lensResults, ...factories]
    .filter((v, i, arr) => arr.findIndex((x) => x.source_url === v.source_url) === i)
    .slice(0, 5);

  return {
    step1_sourcing: allFactories.length > 0 ? allFactories : getStubCandidates(params.keyword),
    step2_qc_packaging: getQcHubs(params.sourcingRegion),
    step3_forwarding: forwarders,
    step4_customs: buildCustomsInfo(params.hintHsCode, params.destinationCity),
    step5_inland: inland,
  };
}
