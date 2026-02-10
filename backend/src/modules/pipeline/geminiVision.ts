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
};

const MODEL = "gemini-2.5-pro";
const SYSTEM_PROMPT = `You are a product sourcing expert. Analyze this product photo and return a single JSON object (no markdown, no code block) with exactly these keys:
- product_name: string (English, concise)
- product_name_zh: string (Chinese name for 1688.com search)
- category: string (e.g. electronics, apparel, home goods)
- material: string or null (if identifiable)
- estimated_specs: string or null (brief specs if visible)
- search_keywords_1688: array of 3-5 Chinese keywords for searching on 1688.com`;

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

function parseAnalysisJson(text: string): ProductAnalysis {
  console.error("[GEMINI RAW]", text);
  try {
    const trimmed = text.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/, "$1").trim();
    console.error("[GEMINI TRIMMED]", trimmed);
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const arr = parsed.search_keywords_1688;
    const keywords = Array.isArray(arr)
      ? arr.map((x) => (typeof x === "string" ? x : String(x)))
      : typeof parsed.search_keywords_1688 === "string"
        ? [parsed.search_keywords_1688]
        : [];
    return {
      product_name: String(parsed.product_name ?? ""),
      product_name_zh: String(parsed.product_name_zh ?? ""),
      category: String(parsed.category ?? ""),
      material: parsed.material != null ? String(parsed.material) : undefined,
      estimated_specs: parsed.estimated_specs != null ? String(parsed.estimated_specs) : undefined,
      search_keywords_1688: keywords.length ? keywords : [String(parsed.product_name_zh ?? parsed.product_name ?? "product")],
    };
  } catch (err) {
    console.error("[PARSE ERROR]", err);
    throw err;
  }
}

export async function analyzeProductPhoto(
  gcsPath: string,
  bucketName: string,
  mimeType: string = "image/jpeg"
): Promise<ProductAnalysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set");
  }

  const { data, mimeType: mime } = await readImageAsBase64(gcsPath, bucketName, mimeType);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

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
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      response_mime_type: "application/json",
      maxOutputTokens: 2048,
      temperature: 0.4,
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

  return parseAnalysisJson(text);
}
