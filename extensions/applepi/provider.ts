// extensions/applepi/provider.ts
import type { BridgeManager } from "./bridge.js";
import type { BridgeInput } from "./types.js";

/** Extracts the last user message text from the Pi message array */
function extractPrompt(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      const textParts = msg.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text);
      return textParts.join("\n");
    }
  }
  return "";
}

async function* streamAppleIntelligence(
  bridge: BridgeManager,
  model: any,
  context: any,
  _options?: any
): AsyncGenerator<any> {
  const output: any = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  try {
    yield { type: "start", partial: output };

    const prompt = extractPrompt(context.messages);
    if (!prompt) {
      throw new Error("No user message found in the conversation context.");
    }
    const input: BridgeInput = {
      prompt,
      ...(context.systemPrompt ? { system_prompt: context.systemPrompt } : {}),
    };

    const contentIndex = 0;
    let textStarted = false;
    let fullContent = "";

    for await (const event of bridge.stream(input)) {
      if (event.type === "delta") {
        if (!textStarted) {
          output.content.push({ type: "text", text: "" });
          yield { type: "text_start", contentIndex, partial: output };
          textStarted = true;
        }
        fullContent += event.content;
        output.content[contentIndex].text = fullContent;
        yield { type: "text_delta", contentIndex, delta: event.content, partial: output };
      } else if (event.type === "done") {
        fullContent = event.content;
        output.usage.input = event.prompt_tokens;
        output.usage.output = event.completion_tokens;
        output.usage.totalTokens = event.prompt_tokens + event.completion_tokens;

        if (!textStarted) {
          output.content.push({ type: "text", text: fullContent });
          yield { type: "text_start", contentIndex, partial: output };
          textStarted = true;
        }
        output.content[contentIndex].text = fullContent;
      }
    }

    if (textStarted) {
      yield { type: "text_end", contentIndex, content: fullContent, partial: output };
    }

    yield { type: "done", reason: "stop", message: output };
  } catch (error) {
    output.stopReason = "error";
    output.errorMessage = error instanceof Error ? error.message : String(error);
    yield { type: "error", reason: output.stopReason, error: output };
  }
}

export function createProviderConfig(bridge: BridgeManager) {
  return {
    name: "Apple Intelligence",
    baseUrl: "local://on-device",
    apiKey: "not-needed",
    api: "apple-intelligence-api",
    models: [
      {
        id: "apple-intelligence",
        name: "Apple Intelligence (on-device)",
        reasoning: false,
        input: ["text"] as string[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 4096,
      },
    ],
    streamSimple: (model: any, context: any, options?: any) =>
      streamAppleIntelligence(bridge, model, context, options),
  };
}
