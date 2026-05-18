// extensions/applepi/provider.ts
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { BridgeManager } from "./bridge.js";
import type { BridgeInput } from "./types.js";

/**
 * Minimal system prompt for the on-device model.
 * Pi's full system prompt includes tool definitions, project context, skills,
 * and guidelines that easily exceed the 4096-token context window.
 * This compact prompt is all the on-device model needs.
 */
const MINIMAL_SYSTEM_PROMPT =
  "You are a helpful, concise assistant running on-device via Apple Intelligence. " +
  "You have a small context window, so keep responses focused and brief. " +
  "Answer directly without attempting to invoke functions or access external systems.";

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

function streamAppleIntelligence(
  bridge: BridgeManager,
  model: any,
  context: any,
  _options?: any
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
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
      stream.push({ type: "start", partial: output });

      const prompt = extractPrompt(context.messages);
      if (!prompt) {
        throw new Error("No user message found in the conversation context.");
      }

      // Always use the minimal system prompt — Pi's system prompt contains
      // tool definitions and project context that overflow the 4096-token window.
      // Token budgeting and truncation is handled by the Swift bridge using
      // Apple's real tokenCount(for:) API (TN3193).
      const input: BridgeInput = {
        prompt,
        system_prompt: MINIMAL_SYSTEM_PROMPT,
      };

      const contentIndex = 0;
      let textStarted = false;
      let fullContent = "";

      for await (const event of bridge.stream(input)) {
        if (event.type === "delta") {
          if (!textStarted) {
            output.content.push({ type: "text", text: "" });
            stream.push({ type: "text_start", contentIndex, partial: output });
            textStarted = true;
          }
          fullContent += event.content;
          output.content[contentIndex].text = fullContent;
          stream.push({ type: "text_delta", contentIndex, delta: event.content, partial: output });
        } else if (event.type === "done") {
          fullContent = event.content;
          output.usage.input = event.prompt_tokens;
          output.usage.output = event.completion_tokens;
          output.usage.totalTokens = event.prompt_tokens + event.completion_tokens;

          if (!textStarted) {
            output.content.push({ type: "text", text: fullContent });
            stream.push({ type: "text_start", contentIndex, partial: output });
            textStarted = true;
          }
          output.content[contentIndex].text = fullContent;
        }
      }

      if (textStarted) {
        stream.push({ type: "text_end", contentIndex, content: fullContent, partial: output });
      }

      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
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
