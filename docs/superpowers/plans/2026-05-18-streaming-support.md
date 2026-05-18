# Streaming Support Implementation Plan

> For agentic workers: REQUIRED: Use subagent-driven-development
> (if subagents available) or executing-plans to implement this plan.

Goal: Add real streaming support so the on-device model emits tokens incrementally instead of buffering the entire response.
Architecture: Add a `stream()` async generator to `BridgeManager` that reads NDJSON line-by-line from the Swift bridge's stdout, then wire it into the `applepi_query` tool and the `streamSimple` provider so both consumers get incremental output.
Tech Stack: TypeScript, vitest, Node.js child_process + readline.

---

## Context

The Swift bridge already supports streaming — when `stream: true` is in the input JSON, `Generation.stream()` writes NDJSON to stdout:

```
{"type":"delta","content":"Par"}
{"type":"delta","content":"is"}
{"type":"done","content":"Paris","prompt_tokens":0,"completion_tokens":0,"finish_reason":"stop"}
```

The TypeScript types already exist in `extensions/applepi/types.ts`:
- `BridgeStreamDelta` — `{ type: "delta", content: string }`
- `BridgeStreamDone` — `{ type: "done", content, prompt_tokens, completion_tokens, finish_reason }`
- `BridgeStreamEvent` — union of the above

What's missing is the TypeScript plumbing to consume this output.

## File Structure

```
extensions/applepi/
├── bridge.ts          # MODIFY: add stream() async generator method
├── bridge.test.ts     # MODIFY: add streaming tests
├── tools.ts           # MODIFY: re-add stream param to queryTool, branch on it
├── tools.test.ts      # MODIFY: add streaming tool tests
├── provider.ts        # MODIFY: use bridge.stream() in streamSimple
├── provider.test.ts   # MODIFY: add incremental streaming tests
├── types.ts           # NO CHANGES (types already exist)
└── index.ts           # NO CHANGES
```

---

## Task 1: BridgeManager.stream() Method

**Depends on:** Nothing
**Files:**
- Modify: `extensions/applepi/bridge.ts`
- Modify: `extensions/applepi/bridge.test.ts`

This adds an async generator method `stream()` that spawns the bridge with `stream: true`, reads stdout line-by-line, and yields `BridgeStreamEvent` objects. It reuses `ensureBinary()` and the timeout pattern from `spawnBridge`, but instead of buffering all stdout it processes each line as it arrives.

- [ ] Step 1: Write the failing tests

Append to `extensions/applepi/bridge.test.ts`:

```typescript
// Add this import at the top if not already present:
// import type { BridgeStreamEvent } from "./types.js";

describe("BridgeManager — stream", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
  });

  test("yields delta events as lines arrive", async () => {
    const ndjson = [
      '{"type":"delta","content":"Hel"}',
      '{"type":"delta","content":"lo"}',
      '{"type":"done","content":"Hello","prompt_tokens":5,"completion_tokens":2,"finish_reason":"stop"}',
    ].join("\n") + "\n";

    mockedCp.spawn.mockReturnValue(createMockProcess(ndjson));

    const events: any[] = [];
    for await (const event of bridge.stream({ prompt: "Hi" })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "delta", content: "Hel" });
    expect(events[1]).toEqual({ type: "delta", content: "lo" });
    expect(events[2]).toEqual({
      type: "done",
      content: "Hello",
      prompt_tokens: 5,
      completion_tokens: 2,
      finish_reason: "stop",
    });
  });

  test("sends input with stream: true to stdin", async () => {
    const ndjson =
      '{"type":"done","content":"ok","prompt_tokens":1,"completion_tokens":1,"finish_reason":"stop"}\n';

    const mockProc = createMockProcess(ndjson);
    const writeSpy = vi.spyOn(mockProc.stdin as any, "write");
    mockedCp.spawn.mockReturnValue(mockProc);

    const events: any[] = [];
    for await (const event of bridge.stream({ prompt: "test" })) {
      events.push(event);
    }

    expect(writeSpy).toHaveBeenCalled();
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.stream).toBe(true);
    expect(parsed.prompt).toBe("test");
  });

  test("throws on non-zero exit code", async () => {
    const stderrJson = JSON.stringify({
      error: "guardrail_blocked",
      message: "Blocked",
    });

    mockedCp.spawn.mockReturnValue(createMockProcess("", stderrJson, 3));

    const events: any[] = [];
    await expect(async () => {
      for await (const event of bridge.stream({ prompt: "bad" })) {
        events.push(event);
      }
    }).rejects.toThrow(/safety guardrails/);
  });

  test("skips empty lines in NDJSON", async () => {
    const ndjson = [
      '{"type":"delta","content":"Hi"}',
      "",
      '{"type":"done","content":"Hi","prompt_tokens":1,"completion_tokens":1,"finish_reason":"stop"}',
      "",
    ].join("\n");

    mockedCp.spawn.mockReturnValue(createMockProcess(ndjson));

    const events: any[] = [];
    for await (const event of bridge.stream({ prompt: "Hi" })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });

  test("ensures binary is built before streaming", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCp.execSync.mockReturnValue(Buffer.from("Build complete!"));

    const ndjson =
      '{"type":"done","content":"ok","prompt_tokens":1,"completion_tokens":1,"finish_reason":"stop"}\n';
    mockedCp.spawn.mockReturnValue(createMockProcess(ndjson));

    for await (const _event of bridge.stream({ prompt: "hi" })) {
      // consume
    }

    expect(mockedCp.execSync).toHaveBeenCalledWith(
      "swift build -c release",
      expect.anything()
    );
  });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — `bridge.stream is not a function`

- [ ] Step 3: Add the `stream()` method to `BridgeManager` in `extensions/applepi/bridge.ts`

Add this method to the `BridgeManager` class, after the `benchmark()` method:

```typescript
  /** Runs a generation request with streaming, yielding events as they arrive */
  async *stream(
    input: BridgeInput
  ): AsyncGenerator<BridgeStreamEvent, void, unknown> {
    this.ensureBinary();

    const streamInput = { ...input, stream: true };
    const proc = childProcess.spawn(this.getBinaryPath(), [], {
      cwd: this.bridgeDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, BridgeManager.TIMEOUT_MS);

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.stdin!.write(JSON.stringify(streamInput));
    proc.stdin!.end();

    // Read stdout line-by-line and yield parsed events
    let buffer = "";
    const lines: string[] = [];
    let resolveData: (() => void) | null = null;
    let done = false;
    let exitCode: number | null = null;

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop()!; // last element is incomplete or empty
      for (const line of parts) {
        if (line.trim()) {
          lines.push(line);
        }
      }
      if (resolveData) resolveData();
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      exitCode = code;
      done = true;
      // Flush remaining buffer
      if (buffer.trim()) {
        lines.push(buffer.trim());
        buffer = "";
      }
      if (resolveData) resolveData();
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      done = true;
      exitCode = 1;
      stderr = err.message;
      if (resolveData) resolveData();
    });

    // Yield events as lines arrive
    while (true) {
      while (lines.length > 0) {
        const line = lines.shift()!;
        try {
          yield JSON.parse(line) as BridgeStreamEvent;
        } catch {
          // skip unparseable lines
        }
      }

      if (done) break;

      // Wait for more data or close
      await new Promise<void>((resolve) => {
        resolveData = resolve;
      });
      resolveData = null;
    }

    // Check for errors after process exits
    if (timedOut) {
      throw new Error(bridgeErrorMessage("timeout"));
    }

    if (exitCode !== 0 && exitCode !== null) {
      let errorCode = BRIDGE_EXIT_CODES[exitCode] ?? "unknown";
      try {
        const parsed = JSON.parse(stderr);
        if (parsed.error) {
          errorCode = parsed.error;
        }
      } catch {
        // use exit code mapping
      }
      throw new Error(bridgeErrorMessage(errorCode));
    }
  }
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests including new streaming tests)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/bridge.ts extensions/applepi/bridge.test.ts
git commit -m "feat: add BridgeManager.stream() async generator for NDJSON"
```

---

## Task 2: Wire Streaming into applepi_query Tool

**Depends on:** Task 1
**Files:**
- Modify: `extensions/applepi/tools.ts`
- Modify: `extensions/applepi/tools.test.ts`

Re-add the `stream` parameter to `applepi_query`. When `stream: true`, call `bridge.stream()` and concatenate deltas into the final result. The tool still returns a single `ToolResult` — tools don't support incremental output — but using streaming avoids buffering the entire response in the bridge process before returning.

- [ ] Step 1: Write the failing tests

Add to `extensions/applepi/tools.test.ts`, inside the existing `describe("applepi_query")` block:

```typescript
    test("uses bridge.stream when stream option is true", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;

      const mockStream = (async function* () {
        yield { type: "delta" as const, content: "Hel" };
        yield { type: "delta" as const, content: "lo" };
        yield {
          type: "done" as const,
          content: "Hello",
          prompt_tokens: 5,
          completion_tokens: 2,
          finish_reason: "stop",
        };
      })();

      vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);

      const result = await tool.execute(
        "call-1",
        { prompt: "Hi", stream: true },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect((mockBridge as any).stream).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Hi" })
      );
      expect(result.content[0]).toEqual(
        expect.objectContaining({ type: "text", text: "Hello" })
      );
    });

    test("stream mode returns token counts from done event", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;

      const mockStream = (async function* () {
        yield {
          type: "done" as const,
          content: "Hi",
          prompt_tokens: 10,
          completion_tokens: 3,
          finish_reason: "stop",
        };
      })();

      vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);

      const result = await tool.execute(
        "call-1",
        { prompt: "Hey", stream: true },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(result.details).toEqual(
        expect.objectContaining({
          prompt_tokens: 10,
          completion_tokens: 3,
          finish_reason: "stop",
        })
      );
    });

    test("defaults to non-streaming (bridge.run)", async () => {
      const tool = tools.find((t) => t.name === "applepi_query")!;
      vi.mocked(mockBridge.run).mockResolvedValue({
        content: "Paris",
        prompt_tokens: 12,
        completion_tokens: 3,
        finish_reason: "stop",
      });

      await tool.execute(
        "call-1",
        { prompt: "capital of France?" },
        new AbortController().signal,
        vi.fn(),
        {} as any
      );

      expect(mockBridge.run).toHaveBeenCalled();
    });
```

Also update the `beforeEach` mock to include `stream`:
```typescript
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
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — stream parameter not in tool schema / stream method not called

- [ ] Step 3: Update `applepi_query` in `extensions/applepi/tools.ts`

Add the `stream` parameter back to the TypeBox schema:

```typescript
      stream: Type.Optional(
        Type.Boolean({
          description: "Stream response token-by-token (reduces time-to-first-byte)",
          default: false,
        })
      ),
```

Replace the `execute` function body of `queryTool`:

```typescript
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
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

        for await (const event of bridge.stream(input)) {
          if (event.type === "delta") {
            content += event.content;
          } else if (event.type === "done") {
            content = event.content;
            promptTokens = event.prompt_tokens;
            completionTokens = event.completion_tokens;
            finishReason = event.finish_reason;
          }
        }

        return textResult(content, {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          finish_reason: finishReason,
        });
      }

      const result = await bridge.run(input);
      return textResult(result.content, {
        prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens,
        finish_reason: result.finish_reason,
      });
    },
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/tools.ts extensions/applepi/tools.test.ts
git commit -m "feat: wire streaming into applepi_query tool"
```

---

## Task 3: Real Incremental Streaming in Provider

**Depends on:** Task 1
**Files:**
- Modify: `extensions/applepi/provider.ts`
- Modify: `extensions/applepi/provider.test.ts`

Change `streamSimple` to use `bridge.stream()` instead of `bridge.run()`. Each `BridgeStreamDelta` becomes a `text_delta` yield, giving the user token-by-token output when using `/model apple-intelligence`.

- [ ] Step 1: Write the failing tests

Add to `extensions/applepi/provider.test.ts`, inside the existing `describe("createProviderConfig")`:

```typescript
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

    vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);

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

    vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);

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
```

Also update the `beforeEach` mock to include `stream`:
```typescript
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
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — `stream` is not a function on mockBridge (old tests) or wrong number of text_deltas

- [ ] Step 3: Update `streamAppleIntelligence` in `extensions/applepi/provider.ts`

Replace the `streamAppleIntelligence` function body. Change `bridge.run(input)` to `bridge.stream(input)` and yield `text_delta` for each incoming delta:

```typescript
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
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests)

**Note:** Some existing provider tests that expected `bridge.run` to be called will now fail since we switched to `bridge.stream`. Update those tests:

In the existing `streamSimple emits start, text, and done events` test, change the mock from `mockBridge.run` to `(mockBridge as any).stream` returning an async generator:

```typescript
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

    vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);

    // ... rest of test stays the same
```

Similarly update the `streamSimple emits error event on failure` test to make `(mockBridge as any).stream` throw:

```typescript
    const mockStream = (async function* () {
      throw new Error("Model unavailable");
    })();

    vi.mocked(mockBridge as any).stream = vi.fn().mockReturnValue(mockStream);
```

And update the `streamSimple extracts last user message as prompt` test similarly.

- [ ] Step 5: Commit

```bash
git add extensions/applepi/provider.ts extensions/applepi/provider.test.ts
git commit -m "feat: use bridge.stream() for real incremental streaming in provider"
```

---

## Task Dependency Graph

```
Task 1 (BridgeManager.stream)
├── Task 2 (queryTool streaming)
└── Task 3 (provider streaming)
```

Tasks 2 and 3 depend on Task 1 but are independent of each other. However, since they both touch test mocks in overlapping patterns, execute them sequentially to avoid merge conflicts.
