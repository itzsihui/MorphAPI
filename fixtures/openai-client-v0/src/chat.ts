import OpenAI from "openai-chat-v0";

/**
 * Chat helpers using the deprecated v0 chat create API.
 * Migrate to openai-chat-v1 nested completions.create with model id.
 */
export async function askOnce(prompt: string): Promise<string> {
  const openai = new OpenAI(process.env.OPENAI_API_KEY ?? "sk-demo");

  // Usage site 1 — single-turn GPT-4 style call
  const response = await openai.ChatCompletion.create({
    engine: "gpt-4",
    messages: [{ role: "user", content: prompt }],
  });

  return response.choices[0].message.content;
}

export async function askWithSystem(
  system: string,
  prompt: string
): Promise<string> {
  const openai = new OpenAI(process.env.OPENAI_API_KEY ?? "sk-demo");

  // Usage site 2 — system + user
  const response = await openai.ChatCompletion.create({
    engine: "gpt-4",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  return response.choices[0].message.content;
}
