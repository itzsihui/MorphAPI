import * as fs from "fs";
import * as path from "path";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGenerateOptions {
  messages: LlmMessage[];
}

function requireApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.MORPHAPI_LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY (or MORPHAPI_LLM_API_KEY) is required. Add it to .env — offline fixtures were removed."
    );
  }
  return apiKey;
}

/**
 * OpenAI-compatible chat completion. Always live — no offline fixture fallback.
 */
export async function generateCode(options: LlmGenerateOptions): Promise<{
  code: string;
  mode: "live";
  model: string;
}> {
  const apiKey = requireApiKey();
  const baseUrl =
    process.env.OPENAI_BASE_URL ??
    process.env.MORPHAPI_LLM_BASE_URL ??
    "https://api.openai.com/v1";
  const model = process.env.MORPHAPI_LLM_MODEL ?? "gpt-4o-mini";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: options.messages,
      }),
    });
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err
        ? (err as Error & { cause?: { code?: string; hostname?: string } }).cause
        : undefined;
    if (cause?.code === "ENOTFOUND" || /ENOTFOUND|fetch failed/i.test(String(err))) {
      throw new Error(
        `Cannot reach ${baseUrl} (DNS/network). Run \`npm run demo:ui\` in your own terminal (not a sandboxed agent), check Wi‑Fi/VPN, and that api.openai.com resolves.`
      );
    }
    throw new Error(
      `LLM network error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return { code: stripCodeFences(content), mode: "live", model };
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(
    /^```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```$/
  );
  if (fence) return fence[1].trim() + "\n";
  const blocks = [
    ...trimmed.matchAll(/```(?:typescript|ts)?\s*([\s\S]*?)```/g),
  ];
  if (blocks.length > 0) {
    return (
      blocks.map((b) => b[1].trim()).sort((a, b) => b.length - a.length)[0] +
      "\n"
    );
  }
  return trimmed + "\n";
}

export function readUtf8(...parts: string[]): string {
  return fs.readFileSync(path.join(...parts), "utf8");
}

export function writeUtf8(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
