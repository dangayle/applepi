import { describe, test, expect, vi, beforeEach } from "vitest";
import { createTools } from "./tools.js";
import { BridgeManager } from "./bridge.js";

vi.mock("./bridge.js");

describe("createTools", () => {
  let mockBridge: BridgeManager;
  let tools: ReturnType<typeof createTools>;

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

    tools = createTools(mockBridge);
    vi.clearAllMocks();
  });

  test("returns three tool definitions", () => {
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "applepi_query",
      "applepi_generate",
      "applepi_benchmark",
    ]);
  });

  describe("applepi_query", () => {
    test("has correct metadata", () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;
      expect(tool.label).toBe("Apple Intelligence Query");
      expect(tool.description).toContain("on-device");
    });

    test("calls bridge.run with the prompt", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;
      vi.mocked(mockBridge.run).mockResolvedValue({
        content: "Paris",
        prompt_tokens: 12,
        completion_tokens: 3,
        finish_reason: "stop",
      });

      const result = await tool.execute(
        "call-1",
        { prompt: "What is the capital of France?" },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(mockBridge.run).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "What is the capital of France?" })
      );
      expect(result.content[0]).toEqual(
        expect.objectContaining({ type: "text", text: expect.stringContaining("Paris") })
      );
    });

    test("passes system_prompt and permissive options", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;
      vi.mocked(mockBridge.run).mockResolvedValue({
        content: "ok",
        prompt_tokens: 1,
        completion_tokens: 1,
        finish_reason: "stop",
      });

      await tool.execute(
        "call-1",
        {
          prompt: "hello",
          system_prompt: "be brief",
          permissive: true,
          temperature: 0.5,
          max_tokens: 100,
        },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(mockBridge.run).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "hello",
          system_prompt: "be brief",
          permissive: true,
          temperature: 0.5,
          max_tokens: 100,
        })
      );
    });

    test("throws on failure (Pi sets isError automatically)", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;
      vi.mocked(mockBridge.run).mockRejectedValue(
        new Error("Apple's safety guardrails blocked this request.")
      );

      await expect(
        tool.execute(
          "call-1",
          { prompt: "bad" },
          new AbortController().signal,
          vi.fn(),
          {} as any
        )
      ).rejects.toThrow(/guardrails/);
    });
  });

  describe("applepi_generate", () => {
    test("has correct metadata", () => {
      const tool = tools.find((t) => t.name === "applepi_generate")!;
      expect(tool.label).toBe("Apple Intelligence Generate");
      expect(tool.description).toContain("structured");
    });

    test("calls bridge.run with prompt and schema", async () => {
      const tool = tools.find((t) => t.name === "applepi_generate")!;
      const schema = {
        type: "object",
        properties: { severity: { type: "string" } },
        required: ["severity"],
      };

      vi.mocked(mockBridge.run).mockResolvedValue({
        content: '{"severity":"high"}',
        structured: { severity: "high" },
        prompt_tokens: 18,
        completion_tokens: 12,
        finish_reason: "stop",
      });

      const result = await tool.execute(
        "call-1",
        { prompt: "classify this", schema },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(mockBridge.run).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "classify this", schema })
      );
      const text = result.content[0];
      expect(text).toEqual(
        expect.objectContaining({ type: "text" })
      );
    });
  });

  describe("applepi_benchmark", () => {
    test("has correct metadata", () => {
      const tool = tools.find((t) => t.name === "applepi_benchmark")!;
      expect(tool.label).toBe("Apple Intelligence Benchmark");
    });

    test("calls bridge.benchmark and returns results", async () => {
      const tool = tools.find((t) => t.name === "applepi_benchmark")!;
      vi.mocked(mockBridge.benchmark).mockResolvedValue({
        available: true,
        tokens_per_second: 42.5,
        latency_ms: 1850,
        prompt_tokens: 8,
        completion_tokens: 78,
      });

      const result = await tool.execute(
        "call-1",
        {},
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(mockBridge.benchmark).toHaveBeenCalled();
      expect(result.content[0]).toEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("42.5"),
        })
      );
    });

    test("throws on unavailable model (Pi sets isError automatically)", async () => {
      const tool = tools.find((t) => t.name === "applepi_benchmark")!;
      vi.mocked(mockBridge.benchmark).mockRejectedValue(
        new Error("On-device model is unavailable.")
      );

      await expect(
        tool.execute(
          "call-1",
          {},
          new AbortController().signal,
          vi.fn(),
          {} as any
        )
      ).rejects.toThrow(/unavailable/);
    });
  });
});
