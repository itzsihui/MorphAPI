/**
 * Legacy OpenAI-style chat surface (v0.28-era training-data patterns).
 * Uses ChatCompletion.create + `engine` — NOT the modern client.chat.completions API.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionCreateParams {
  /** @deprecated Use `model` on openai-chat-v1 */
  engine: string;
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

export default class OpenAI {
  constructor(private _apiKey: string) {}

  ChatCompletion = {
    create: async (
      params: ChatCompletionCreateParams
    ): Promise<ChatCompletion> => {
      return {
        id: `chatcmpl-legacy-${params.engine}`,
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
  };
}
