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

    vi.mocked(mockBridge.run).mockResolvedValue({
      content: "Hello world",
      prompt_tokens: 5,
      completion_tokens: 2,
      finish_reason: "stop",
    });

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

    vi.mocked(mockBridge.run).mockRejectedValue(
      new Error("Model unavailable")
    );

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
  });

  test("streamSimple extracts last user message as prompt", async () => {
    const config = createProviderConfig(mockBridge);

    vi.mocked(mockBridge.run).mockResolvedValue({
      content: "Response",
      prompt_tokens: 10,
      completion_tokens: 1,
      finish_reason: "stop",
    });

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

    expect(mockBridge.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Second message",
        system_prompt: "You are helpful",
      })
    );
  });
});
