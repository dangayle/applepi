import { Type } from "@sinclair/typebox";
import type { BridgeManager } from "./bridge.js";
import type { BridgeInput } from "./types.js";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: any,
    signal: AbortSignal,
    onUpdate: (update: any) => void,
    ctx: any
  ): Promise<ToolResult>;
}

function textResult(text: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details: details ?? {} };
}

export function createTools(bridge: BridgeManager): ToolDefinition[] {
  const queryTool: ToolDefinition = {
    name: "applepi_query",
    label: "Apple Intelligence Query",
    description:
      "Query Apple's on-device AI model. Free, private, zero API keys. " +
      "Good for: summarization, classification, naming, quick factual lookups, brainstorming — " +
      "anything where a frontier model is overkill. " +
      "Limitations: 4096-token context window, no vision, slower than cloud models.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The prompt to send to the on-device model" }),
      system_prompt: Type.Optional(
        Type.String({ description: "System prompt for context/persona" })
      ),
      permissive: Type.Optional(
        Type.Boolean({
          description: "Use permissive guardrails (reduces false positives)",
          default: false,
        })
      ),
      temperature: Type.Optional(
        Type.Number({ description: "Sampling temperature" })
      ),
      max_tokens: Type.Optional(
        Type.Number({ description: "Maximum response tokens" })
      ),
      stream: Type.Optional(
        Type.Boolean({
          description: "Stream response token-by-token (reduces time-to-first-byte)",
          default: false,
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Prompt is sent as-is to the Swift bridge, which handles token budgeting
      // and truncation using Apple's real tokenCount(for:) API (TN3193).
      const input: BridgeInput = {
        prompt: params.prompt,
        system_prompt: params.system_prompt,
        permissive: params.permissive,
        temperature: params.temperature ?? null,
        max_tokens: params.max_tokens ?? null,
      };

      if (params.stream) {
        let content = "";
        let promptTokens = 0;
        let completionTokens = 0;
        let finishReason = "stop";
        let truncated = false;
        let contextSize: number | undefined;

        for await (const event of bridge.stream(input)) {
          if (event.type === "delta") {
            content += event.content;
          } else if (event.type === "done") {
            content = event.content;
            promptTokens = event.prompt_tokens;
            completionTokens = event.completion_tokens;
            finishReason = event.finish_reason;
            truncated = (event as any).truncated ?? false;
            contextSize = (event as any).context_size;
          }
        }

        return textResult(content, {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          finish_reason: finishReason,
          truncated,
          ...(contextSize != null && { context_size: contextSize }),
        });
      }

      const result = await bridge.run(input);
      return textResult(result.content, {
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        finish_reason: result.finish_reason,
        truncated: result.truncated ?? false,
        ...(result.context_size != null && { context_size: result.context_size }),
      });
    },
  };

  const generateTool: ToolDefinition = {
    name: "applepi_generate",
    label: "Apple Intelligence Generate",
    description:
      "Generate structured JSON output from Apple's on-device model. " +
      "Provide a JSON Schema and the model will produce valid JSON matching it. " +
      "Good for: classification, entity extraction, structured data creation.",
    parameters: Type.Object({
      prompt: Type.String({ description: "What to generate" }),
      schema: Type.Any({ description: "JSON Schema for the output shape" }),
      system_prompt: Type.Optional(
        Type.String({ description: "System prompt for context" })
      ),
      permissive: Type.Optional(
        Type.Boolean({
          description: "Use permissive guardrails",
          default: false,
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Schema may arrive as a JSON string from the LLM tool call — parse it
      let schema = params.schema;
      if (typeof schema === "string") {
        try {
          schema = JSON.parse(schema);
        } catch {
          throw new Error("Invalid JSON schema: could not parse the schema string.");
        }
      }

      const input: BridgeInput = {
        prompt: params.prompt,
        schema,
        system_prompt: params.system_prompt,
        permissive: params.permissive,
      };
      const result = await bridge.run(input);

      const output = result.structured
        ? JSON.stringify(result.structured, null, 2)
        : result.content;

      return textResult(output, {
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        finish_reason: result.finish_reason,
        structured: result.structured,
      });
    },
  };

  const benchmarkTool: ToolDefinition = {
    name: "applepi_benchmark",
    label: "Apple Intelligence Benchmark",
    description:
      "Run a performance benchmark on the on-device Apple Intelligence model. " +
      "Returns tokens per second, latency, and availability status.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const result = await bridge.benchmark();
      const lines = [
        `Available: ${result.available}`,
        `Tokens/sec: ${result.tokens_per_second}`,
        `Latency: ${result.latency_ms}ms`,
        `Prompt tokens: ${result.prompt_tokens}`,
        `Completion tokens: ${result.completion_tokens}`,
      ];
      return textResult(lines.join("\n"), { ...result });
    },
  };

  return [queryTool, generateTool, benchmarkTool];
}
