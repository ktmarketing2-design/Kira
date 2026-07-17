import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY must be set in the environment");
}

const ai = new GoogleGenAI({ apiKey });
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

/**
 * Deliberately no budget/rate-limit gating here -- that stays caller-specific.
 * kira-workers' digest workers use their own Redis-backed daily token budget
 * (see kira-workers/src/lib/gemini.ts, kept separate rather than merged into this shared client
 * since it's coupled to kira-workers' own redis instance and per-module budget keys); kira-api's
 * /ask route uses a distinct per-user daily query-count limiter, a different kind of cap
 * entirely. This client is just the raw model call both can build on.
 */
export async function generateText(prompt: string, systemInstruction?: string, model = DEFAULT_MODEL): Promise<string | null> {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      ...(systemInstruction ? { config: { systemInstruction } } : {}),
    });
    return response.text ?? null;
  } catch (err) {
    console.error("[kira-shared:gemini] generation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
