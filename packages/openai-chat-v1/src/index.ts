/**
 * Target OpenAI Node v1-style client.
 * Real openai@4+: `new OpenAI()` + `client.chat.completions.create({ model })`.
 * `engine` is NOT a valid parameter — that is the scaffolding trap.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionCreateParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatCompletionChoice {
  message: ChatMessage;
  index: number;
}

export interface ChatCompletion {
  id: string;
  choices: ChatCompletionChoice[];
}

export class OpenAI {
  constructor(_opts?: { apiKey?: string }) {}

  chat = {
    completions: {
      create: async (
        params: ChatCompletionCreateParams
      ): Promise<ChatCompletion> => {
        return {
          id: `chatcmpl-${params.model}`,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: `echo:${params.messages.at(-1)?.content ?? ""}`,
              },
            },
          ],
        };
      },
    },
  };
}

export default OpenAI;
