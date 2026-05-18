import { describe, test, expect, vi, beforeEach } from "vitest";
import { createProviderConfig } from "./provider.js";
import { BridgeManager } from "./bridge.js";

vi.mock("./bridge.js");

describe("createProviderConfig", () => {
  let mockBridge: BridgeManager;

  beforeEach(() => {
    mockBridge = {
      run: vi.fn(),
      check: vi.fn(),
      benchmark: vi.fn(),
      stream: vi.fn(),
      ensureBinary: vi.fn(),
      getBinaryPath: vi.fn().mockReturnValue("/fake/path"),
      isBinaryBuilt: vi.fn().mockReturnValue(true),
      build: vi.fn(),
    } as unknown as BridgeManager;
    vi.clearAllMocks();
  });

  test("returns a valid provider config object", () => {
    const config = createProviderConfig(mockBridge);
    expect(config.name).toBe("Apple Intelligence");
    expect(config.api).toBe("apple-intelligence-api");
    expect(config.models).toHaveLength(1);
  });

  test("model has correct properties", () => {
    const config = createProviderConfig(mockBridge);
    const model = config.models[0];
    expect(model.id).toBe("apple-intelligence");
    expect(model.name).toBe("Apple Intelligence (on-device)");
    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(["text"]);
    expect(model.contextWindow).toBe(4096);
    expect(model.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  test("has a streamSimple function", () => {
    const config = createProviderConfig(mockBridge);
    expect(typeof config.streamSimple).toBe("function");
  });

  test("streamSimple emits start, text, and done events", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield { type: "delta" as const, content: "Hello world" };
      yield {
        type: "done" as const,
        content: "Hello world",
        prompt_tokens: 5,
        completion_tokens: 2,
        finish_reason: "stop",
      };
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "Hi" }],
      systemPrompt: "Be helpful",
    } as any;

    const stream = config.streamSimple(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events[0].type).toBe("start");
    expect(events.find((e: any) => e.type === "text_start")).toBeTruthy();
    expect(events.find((e: any) => e.type === "text_end")).toBeTruthy();
    expect(events.find((e: any) => e.type === "done")).toBeTruthy();

    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent.message.usage.input).toBe(5);
    expect(doneEvent.message.usage.output).toBe(2);
  });

  test("streamSimple emits error event on failure", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      throw new Error("Model unavailable");
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "Hi" }],
      systemPrompt: "",
    } as any;

    const stream = config.streamSimple(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const errorEvent = events.find((e: any) => e.type === "error");
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.error.errorMessage).toContain("Model unavailable");
  });

  test("streamSimple throws on empty prompt (no user messages)", async () => {
    const config = createProviderConfig(mockBridge);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "assistant", content: "I am a bot" }],
      systemPrompt: "",
    } as any;

    const stream = config.streamSimple(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const errorEvent = events.find((e: any) => e.type === "error");
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.error.errorMessage).toContain(
      "No user message found in the conversation context."
    );
    expect(mockBridge.run).not.toHaveBeenCalled();
    expect((mockBridge as any).stream).not.toHaveBeenCalled();
  });

  test("streamSimple extracts last user message as prompt", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield { type: "delta" as const, content: "Response" };
      yield {
        type: "done" as const,
        content: "Response",
        prompt_tokens: 10,
        completion_tokens: 1,
        finish_reason: "stop",
      };
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [
        { role: "user", content: "First message" },
        { role: "assistant", content: [{ type: "text", text: "Reply" }] },
        { role: "user", content: "Second message" },
      ],
      systemPrompt: "You are helpful",
    } as any;

    const stream = config.streamSimple(model, context);
    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect((mockBridge as any).stream).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Second message",
      })
    );
  });

  test("streamSimple replaces Pi's bloated system prompt with a minimal one", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield { type: "delta" as const, content: "Hi" };
      yield {
        type: "done" as const,
        content: "Hi",
        prompt_tokens: 5,
        completion_tokens: 1,
        finish_reason: "stop",
      };
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    // Simulate Pi's massive system prompt with tool definitions
    const hugeSystemPrompt = "You are an expert coding assistant. "
      + "Available tools:\n- read: Read file contents\n- bash: Execute bash commands\n"
      + "- edit: Make precise file edits\n".repeat(500);

    const context = {
      messages: [{ role: "user", content: "hello" }],
      systemPrompt: hugeSystemPrompt,
    } as any;

    const stream = config.streamSimple(model, context);
    for await (const _event of stream) { /* consume */ }

    const callArgs = vi.mocked(mockBridge as any).stream.mock.calls[0][0];
    // Must NOT pass the huge prompt through
    expect(callArgs.system_prompt).not.toBe(hugeSystemPrompt);
    expect(callArgs.system_prompt.length).toBeLessThan(500);
    // Must NOT contain tool definitions
    expect(callArgs.system_prompt).not.toContain("Available tools");
    expect(callArgs.system_prompt).not.toContain("bash:");
    expect(callArgs.system_prompt).not.toContain("read:");
  });

  test("streamSimple strips tool definitions from system prompt", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield {
        type: "done" as const,
        content: "ok",
        prompt_tokens: 1,
        completion_tokens: 1,
        finish_reason: "stop",
      };
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "What is 2+2?" }],
      systemPrompt: "You can use these tools:\n<function>read</function>\n<function>bash</function>",
    } as any;

    const stream = config.streamSimple(model, context);
    for await (const _event of stream) { /* consume */ }

    const callArgs = vi.mocked(mockBridge as any).stream.mock.calls[0][0];
    expect(callArgs.system_prompt).not.toContain("<function>");
    expect(callArgs.system_prompt).not.toContain("tools");
  });

  test("streamSimple uses minimal prompt even when systemPrompt is empty", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield {
        type: "done" as const,
        content: "ok",
        prompt_tokens: 1,
        completion_tokens: 1,
        finish_reason: "stop",
      };
    })();
    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "hello" }],
      systemPrompt: "",
    } as any;

    const stream = config.streamSimple(model, context);
    for await (const _event of stream) { /* consume */ }

    const callArgs = vi.mocked(mockBridge as any).stream.mock.calls[0][0];
    expect(callArgs.system_prompt).toBeDefined();
    expect(callArgs.system_prompt.length).toBeGreaterThan(0);
    expect(callArgs.system_prompt.length).toBeLessThan(500);
  });

  test("streamSimple yields incremental text_delta events from bridge.stream", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield { type: "delta" as const, content: "Hel" };
      yield { type: "delta" as const, content: "lo " };
      yield { type: "delta" as const, content: "world" };
      yield {
        type: "done" as const,
        content: "Hello world",
        prompt_tokens: 5,
        completion_tokens: 3,
        finish_reason: "stop",
      };
    })();

    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "Hi" }],
      systemPrompt: "Be helpful",
    } as any;

    const stream = config.streamSimple(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Should have: start, text_start, 3x text_delta, text_end, done
    const deltas = events.filter((e: any) => e.type === "text_delta");
    expect(deltas).toHaveLength(3);
    expect(deltas[0].delta).toBe("Hel");
    expect(deltas[1].delta).toBe("lo ");
    expect(deltas[2].delta).toBe("world");

    const doneEvent = events.find((e: any) => e.type === "done");
    expect(doneEvent.message.usage.input).toBe(5);
    expect(doneEvent.message.usage.output).toBe(3);
    expect(doneEvent.message.content[0].text).toBe("Hello world");
  });

  test("streamSimple calls bridge.stream not bridge.run", async () => {
    const config = createProviderConfig(mockBridge);

    const mockStream = (async function* () {
      yield {
        type: "done" as const,
        content: "ok",
        prompt_tokens: 1,
        completion_tokens: 1,
        finish_reason: "stop",
      };
    })();

    vi.mocked(mockBridge as any).stream.mockReturnValue(mockStream);

    const model = {
      id: "apple-intelligence",
      api: "apple-intelligence-api",
      provider: "apple-intelligence",
      baseUrl: "",
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    } as any;

    const context = {
      messages: [{ role: "user", content: "Hi" }],
      systemPrompt: "",
    } as any;

    const stream = config.streamSimple(model, context);
    for await (const _event of stream) {
      // consume
    }

    expect((mockBridge as any).stream).toHaveBeenCalled();
    expect(mockBridge.run).not.toHaveBeenCalled();
  });
});
