import * as fs from "fs";
import * as path from "path";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Anthropic native API: mark this block as a prompt-cache breakpoint (system messages only). */
  cache?: boolean;
}

export interface LlmGenerateOptions {
  messages: LlmMessage[];
  model?: ModelProfile;
}

/** An OpenAI-compatible endpoint + model id. */
export type ModelProfile = {
  id: "mini" | "frontier" | string;
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  temperature: number;
};

/**
 * `mini`: gpt-4o-mini on OPENAI_* (default).
 * `frontier`: Claude via Anthropic's OpenAI-compatible endpoint
 * (MORPHAPI_FRONTIER_MODEL / _BASE_URL / _API_KEY, or ANTHROPIC_API_KEY).
 */
export function resolveModelProfile(id: string = process.env.MORPHAPI_MODEL_PROFILE ?? "mini"): ModelProfile {
  const temperature = Number(process.env.MORPHAPI_TEMPERATURE ?? 0.2);
  if (id === "frontier") {
    return {
      id,
      model: process.env.MORPHAPI_FRONTIER_MODEL ?? "claude-sonnet-4-5",
      baseUrl: process.env.MORPHAPI_FRONTIER_BASE_URL ?? "https://api.anthropic.com/v1",
      apiKey: process.env.MORPHAPI_FRONTIER_API_KEY ?? process.env.ANTHROPIC_API_KEY,
      temperature,
    };
  }
  return {
    id: "mini",
    model: process.env.MORPHAPI_LLM_MODEL ?? "gpt-4o-mini",
    baseUrl: process.env.OPENAI_BASE_URL ?? process.env.MORPHAPI_LLM_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? process.env.MORPHAPI_LLM_API_KEY,
    temperature,
  };
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
export type LlmUsage = { prompt: number; completion: number; cacheWrite?: number; cacheRead?: number };

/**
 * Anthropic's native Messages API. Used for Anthropic endpoints because the
 * OpenAI-compatible endpoint does not support prompt caching.
 */
async function anthropicMessages(
  baseUrl: string,
  apiKey: string,
  model: string,
  temperature: number,
  messages: LlmMessage[]
): Promise<{ text: string; usage: LlmUsage }> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => ({ type: "text", text: m.content, ...(m.cache ? { cache_control: { type: "ephemeral" } } : {}) }));
  const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  let res: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, temperature, max_tokens: 4096, system, messages: turns }),
    });
    // Retry rate limits and overload with backoff.
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  if (!res || !res.ok) throw new Error(`LLM request failed (${res?.status}): ${await res?.text()}`);
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  const u = json.usage ?? {};
  return {
    text: (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
    usage: {
      prompt: u.input_tokens ?? 0,
      completion: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}

export async function generateCode(options: LlmGenerateOptions): Promise<{
  code: string;
  mode: "live";
  model: string;
  usage: LlmUsage;
}> {
  const profile = options.model;
  if (profile && !profile.apiKey) {
    throw new Error(
      profile.id === "frontier"
        ? "Frontier model needs MORPHAPI_FRONTIER_API_KEY or ANTHROPIC_API_KEY in .env"
        : "OPENAI_API_KEY (or MORPHAPI_LLM_API_KEY) is required in .env"
    );
  }
  const apiKey = profile?.apiKey ?? requireApiKey();
  const baseUrl =
    profile?.baseUrl ??
    process.env.OPENAI_BASE_URL ??
    process.env.MORPHAPI_LLM_BASE_URL ??
    "https://api.openai.com/v1";
  const model = profile?.model ?? process.env.MORPHAPI_LLM_MODEL ?? "gpt-4o-mini";
  const temperature = profile?.temperature ?? 0.2;

  if (/anthropic\.com/.test(baseUrl) && process.env.MORPHAPI_OPENAI_COMPAT !== "1") {
    const r = await anthropicMessages(baseUrl, apiKey, model, temperature, options.messages);
    return { code: stripCodeFences(r.text), mode: "live", model, usage: r.usage };
  }

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
        temperature,
        messages: options.messages.map(({ role, content }) => ({ role, content })),
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
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return {
    code: stripCodeFences(content),
    mode: "live",
    model,
    usage: { prompt: json.usage?.prompt_tokens ?? 0, completion: json.usage?.completion_tokens ?? 0 },
  };
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
