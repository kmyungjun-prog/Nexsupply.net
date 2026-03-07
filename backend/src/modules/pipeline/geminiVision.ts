/**
 * Gemini Vision: 제품 사진 분석 (API Key 방식)
 * generativelanguage.googleapis.com, GEMINI_API_KEY 환경변수 사용.
 */

import { Storage } from "@google-cloud/storage";

export type ProductAnalysis = {
  product_name: string;
  product_name_zh: string;
  category: string;
  material?: string;
  estimated_specs?: string;
  search_keywords_1688: string[];
  recommended_sourcing_region: string;
  hs_code_hint: string;
  shipping_method: "FCL" | "LCL" | "EXPRESS" | "AIR";
  certifications_required?: string[];
  special_notes?: string;
  factory_price_range?: { min: number; max: number; currency: string; unit: string };
  typical_moq?: string;
};

function buildSystemPrompt(destinationCity: string, quantity: number): string {
  return `You are an expert in Chinese manufacturing and international trade logistics.
Analyze this product photo and return a single JSON object with exactly these keys:

{
  "product_name": "영어 제품명",
  "product_name_zh": "중국어 제품명",
  "category": "카테고리",
  "material": "소재",
  "search_keywords_1688": ["키워드1", "키워드2"],
  "recommended_sourcing_region": "Yiwu, Zhejiang",
  "hs_code_hint": "대략적인 HS코드",
  "shipping_method": "LCL",
  "certifications_required": ["CE"],
  "special_notes": "주의사항",
  "factory_price_range": { "min": 1.5, "max": 4.0, "currency": "USD", "unit": "per piece" },
  "typical_moq": "500 pcs"
}

- shipping_method: one of "FCL" | "LCL" | "EXPRESS" | "AIR" based on quantity ${quantity} units to ${destinationCity}.
- certifications_required: array for ${destinationCity} market (e.g. ["CE", "FCC"]) or empty array [].
- factory_price_range: estimated FOB factory price range in USD based on your knowledge of Chinese manufacturing costs for this product type and material.
- typical_moq: typical minimum order quantity for this product category on 1688 (e.g. "500 pcs", "1000 pcs", "1 carton").
- Use null for optional fields if unknown.

Return ONLY valid JSON. No explanation. No markdown. Keep all string values under 100 characters.`;
}

function getStorageClient(): Storage {
  return new Storage();
}

async function readImageAsBase64(gcsPath: string, bucketName: string, mimeType: string): Promise<{ data: string; mimeType: string }> {
  const client = getStorageClient();
  const bucket = client.bucket(bucketName);
  const file = bucket.file(gcsPath);
  const [buf] = await file.download();
  const data = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf as ArrayBuffer).toString("base64");
  return { data, mimeType: mimeType || "image/jpeg" };
}

function parseAnalysisJson(raw: string): Record<string, unknown> {
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {}
  }

  if (start !== -1) {
    let partial = text.slice(start);
    const quoteCount = (partial.match(/(?<!\\)"/g) ?? []).length;
    if (quoteCount % 2 !== 0) partial += '"';
    const opens = (partial.match(/[\[{]/g) ?? []).length;
    const closes = (partial.match(/[\]}]/g) ?? []).length;
    for (let i = 0; i < opens - closes; i++) partial += "}";
    try {
      return JSON.parse(partial) as Record<string, unknown>;
    } catch {}
  }

  console.warn("parseAnalysisJson: all parse attempts failed, returning empty object");
  return {};
}

function toProductAnalysis(parsed: Record<string, unknown>): ProductAnalysis {
  const arr = parsed.search_keywords_1688;
  const keywords = Array.isArray(arr)
    ? arr.map((x) => (typeof x === "string" ? x : String(x)))
    : typeof parsed.search_keywords_1688 === "string"
      ? [parsed.search_keywords_1688]
      : [];
  const certs = parsed.certifications_required;
  const certsArr = Array.isArray(certs) ? certs.map((x) => String(x)) : [];
  const shipping = String(parsed.shipping_method ?? "LCL").toUpperCase();
  const validShipping = ["FCL", "LCL", "EXPRESS", "AIR"].includes(shipping) ? (shipping as ProductAnalysis["shipping_method"]) : "LCL";

  return {
    product_name: String(parsed.product_name ?? ""),
    product_name_zh: String(parsed.product_name_zh ?? ""),
    category: String(parsed.category ?? ""),
    material: parsed.material != null ? String(parsed.material) : undefined,
    estimated_specs: parsed.estimated_specs != null ? String(parsed.estimated_specs) : undefined,
    search_keywords_1688: keywords.length ? keywords : [String(parsed.product_name_zh ?? parsed.product_name ?? "product")],
    recommended_sourcing_region: String(parsed.recommended_sourcing_region ?? "Guangdong, China"),
    hs_code_hint: String(parsed.hs_code_hint ?? ""),
    shipping_method: validShipping,
    certifications_required: certsArr.length ? certsArr : undefined,
    special_notes: parsed.special_notes != null ? String(parsed.special_notes) : undefined,
    factory_price_range:
      parsed.factory_price_range != null && typeof parsed.factory_price_range === "object"
        ? {
            min: Number((parsed.factory_price_range as Record<string, unknown>).min ?? 0),
            max: Number((parsed.factory_price_range as Record<string, unknown>).max ?? 0),
            currency: String((parsed.factory_price_range as Record<string, unknown>).currency ?? "USD"),
            unit: String((parsed.factory_price_range as Record<string, unknown>).unit ?? "per piece"),
          }
        : undefined,
    typical_moq: parsed.typical_moq != null ? String(parsed.typical_moq) : undefined,
  };
}

export async function analyzeProductPhoto(
  gcsPath: string,
  bucketName: string,
  mimeType: string = "image/jpeg",
  destinationCity: string = "USA",
  quantity: number = 500
): Promise<ProductAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set");
  }

  const { data, mimeType: mime } = await readImageAsBase64(gcsPath, bucketName, mimeType);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Analyze the product in this image and respond with the requested JSON only." },
          {
            inlineData: {
              mimeType: mime,
              data,
            },
          },
        ],
      },
    ],
    system_instruction: { parts: [{ text: buildSystemPrompt(destinationCity, quantity) }] },
    generationConfig: {
      response_mime_type: "application/json",
      maxOutputTokens: 1024,
      temperature: 0.1,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Vision API error ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  console.error("[GEMINI FULL RESPONSE]", JSON.stringify(json, null, 2));
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) {
    throw new Error("Gemini Vision returned no text");
  }

  return toProductAnalysis(parseAnalysisJson(text));
}
