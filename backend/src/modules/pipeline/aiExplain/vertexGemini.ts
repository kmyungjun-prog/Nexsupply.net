/**
 * Phase-D: Gemini via @google/generative-ai (GEMINI_API_KEY).
 * Vertex AI 불필요.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

export const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 300;
const TEMPERATURE = 0.2;

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
  const modelName = getModelVersion();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: options.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
      temperature: options.temperature ?? TEMPERATURE,
    },
  });
  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  if (text == null) {
    throw new Error("Gemini API returned no text");
  }
  return text;
}
