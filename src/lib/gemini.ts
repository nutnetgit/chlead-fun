// Gemini REST client for Ch.Lead FUN. Key + model come from env (FUN has its
// OWN Gemini project/key, separate from Nong Count — handoff §6).
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

export function geminiReady(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Call Gemini with a single text prompt, asking for JSON back. Returns the raw
 * text (parse with parseModelJson). Throws if the key is unset or the call fails.
 */
export async function callGeminiJson(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = geminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/**
 * Parse JSON returned by a model robustly — strips ```json fences and grabs the
 * outermost object/array if the model wraps it in prose (CATS pattern).
 */
export function parseModelJson<T = unknown>(text: string): T {
  let t = (text ?? "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!t.startsWith("{") && !t.startsWith("[")) {
    const objStart = t.indexOf("{");
    const arrStart = t.indexOf("[");
    const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  }
  return JSON.parse(t) as T;
}

// PDPA: never send a full phone to an external AI API — mask to last 4 digits.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return "xxxx" + digits.slice(-4);
}
