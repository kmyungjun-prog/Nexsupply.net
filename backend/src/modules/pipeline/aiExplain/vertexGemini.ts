/**
 * Phase-D: Gemini via Vertex AI. Explanation-only; token limit and low temperature.
 * Uses process.env: GCP_PROJECT (or GOOGLE_CLOUD_PROJECT), VERTEX_AI_LOCATION, GEMINI_MODEL.
 */

import { GoogleAuth } from "google-auth-library";

const DEFAULT_LOCATION = "us-central1";
/** Fixed in value_json as model_version for audit/reproducibility. */
export const DEFAULT_MODEL = "gemini-1.5-flash";
const MAX_OUTPUT_TOKENS = 300;
const TEMPERATURE = 0.2;

/** Resolved model version (env or default); store in value_json. */
export function getModelVersion(): string {
  return process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
}

export type GenerateOptions = {
  maxOutputTokens?: number;
  temperature?: number;
};

export async function generateContent(
  systemPrompt: string,
  userPrompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const projectId = process.env.GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.VERTEX_AI_LOCATION ?? DEFAULT_LOCATION;
  const model = getModelVersion();
  if (!projectId) {
    throw new Error("GCP_PROJECT or GOOGLE_CLOUD_PROJECT required for Vertex AI");
  }

  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Failed to get Vertex AI access token");
  }

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const body = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      temperature: options.temperature ?? TEMPERATURE,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token.token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vertex AI error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) {
    throw new Error("Vertex AI returned no text");
  }
  return text;
}
