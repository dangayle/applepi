import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { Readable, PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { BridgeManager } from "./bridge.js";

// Mock fs and child_process
vi.mock("node:fs");
vi.mock("node:child_process");

const mockedFs = vi.mocked(fs);
const mockedCp = vi.mocked(childProcess);

function createMockProcess(
  stdout: string,
  stderr: string = "",
  exitCode: number = 0
): ChildProcess {
  const proc = {
    stdout: Readable.from([stdout]),
    stderr: Readable.from([stderr]),
    stdin: new PassThrough(),
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === "close") {
        setTimeout(() => cb(exitCode), 10);
      }
      return proc;
    }),
    kill: vi.fn(),
  } as unknown as ChildProcess;
  return proc;
}

describe("BridgeManager", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
  });

  describe("getBinaryPath", () => {
    test("returns the release binary path", () => {
      expect(bridge.getBinaryPath()).toBe(
        "/fake/bridge/.build/release/applepi-bridge"
      );
    });
  });

  describe("isBinaryBuilt", () => {
    test("returns true when binary exists", () => {
      mockedFs.existsSync.mockReturnValue(true);
      expect(bridge.isBinaryBuilt()).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(
        "/fake/bridge/.build/release/applepi-bridge"
      );
    });

    test("returns false when binary does not exist", () => {
      mockedFs.existsSync.mockReturnValue(false);
      expect(bridge.isBinaryBuilt()).toBe(false);
    });
  });

  describe("build", () => {
    test("runs swift build in the bridge directory", () => {
      mockedCp.execSync.mockReturnValue(Buffer.from("Build complete!"));
      bridge.build();
      expect(mockedCp.execSync).toHaveBeenCalledWith(
        "swift build -c release",
        expect.objectContaining({ cwd: "/fake/bridge" })
      );
    });

    test("throws a clear error when swift is not found", () => {
      const error = new Error("Command failed") as Error & { status: number };
      error.status = 127;
      mockedCp.execSync.mockImplementation(() => {
        throw error;
      });

      expect(() => bridge.build()).toThrow(
        /Swift.*Install Xcode Command Line Tools/
      );
    });

    test("throws with build output on other failures", () => {
      const error = new Error("Compilation error") as Error & {
        status: number;
        stderr: Buffer;
      };
      error.status = 1;
      error.stderr = Buffer.from("error: cannot find module");
      mockedCp.execSync.mockImplementation(() => {
        throw error;
      });

      expect(() => bridge.build()).toThrow(/Failed to compile/);
    });
  });

  describe("ensureBinary", () => {
    test("does not rebuild when binary already exists", () => {
      mockedFs.existsSync.mockReturnValue(true);
      bridge.ensureBinary();
      expect(mockedCp.execSync).not.toHaveBeenCalled();
    });

    test("builds when binary is missing", () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedCp.execSync.mockReturnValue(Buffer.from("Build complete!"));
      bridge.ensureBinary();
      expect(mockedCp.execSync).toHaveBeenCalledWith(
        "swift build -c release",
        expect.objectContaining({ cwd: "/fake/bridge" })
      );
    });
  });
});

describe("BridgeManager — run", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
  });

  test("sends input to stdin and returns parsed output", async () => {
    const output = JSON.stringify({
      content: "Paris",
      prompt_tokens: 12,
      completion_tokens: 3,
      finish_reason: "stop",
    });

    mockedCp.spawn.mockReturnValue(createMockProcess(output));

    const result = await bridge.run({ prompt: "What is the capital of France?" });
    expect(result.content).toBe("Paris");
    expect(result.prompt_tokens).toBe(12);
    expect(result.completion_tokens).toBe(3);
  });

  test("throws with user-facing message on guardrail exit code", async () => {
    const stderrJson = JSON.stringify({
      error: "guardrail_blocked",
      message: "Blocked by safety",
    });

    mockedCp.spawn.mockReturnValue(createMockProcess("", stderrJson, 3));

    await expect(bridge.run({ prompt: "bad prompt" })).rejects.toThrow(
      /safety guardrails/
    );
  });

  test("throws with user-facing message on context overflow", async () => {
    const stderrJson = JSON.stringify({
      error: "context_overflow",
      message: "Too long",
    });

    mockedCp.spawn.mockReturnValue(createMockProcess("", stderrJson, 4));

    await expect(bridge.run({ prompt: "very long..." })).rejects.toThrow(
      /4096-token context window/
    );
  });

  test("ensures binary is built before running", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCp.execSync.mockReturnValue(Buffer.from("Build complete!"));

    const output = JSON.stringify({
      content: "ok",
      prompt_tokens: 1,
      completion_tokens: 1,
      finish_reason: "stop",
    });
    mockedCp.spawn.mockReturnValue(createMockProcess(output));

    await bridge.run({ prompt: "hello" });
    expect(mockedCp.execSync).toHaveBeenCalledWith(
      "swift build -c release",
      expect.anything()
    );
  });
});

describe("BridgeManager — check", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
  });

  test("returns availability info", async () => {
    const output = JSON.stringify({ available: true, reason: null });
    mockedCp.spawn.mockReturnValue(createMockProcess(output));

    const result = await bridge.check();
    expect(result.available).toBe(true);
    expect(result.reason).toBeNull();
  });

  test("returns unavailable with reason", async () => {
    const output = JSON.stringify({
      available: false,
      reason: "apple_intelligence_not_enabled",
    });
    mockedCp.spawn.mockReturnValue(createMockProcess(output));

    const result = await bridge.check();
    expect(result.available).toBe(false);
    expect(result.reason).toBe("apple_intelligence_not_enabled");
  });
});

describe("BridgeManager — benchmark", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
  });

  test("returns benchmark results", async () => {
    const output = JSON.stringify({
      available: true,
      tokens_per_second: 42.5,
      latency_ms: 1850,
      prompt_tokens: 8,
      completion_tokens: 78,
    });
    mockedCp.spawn.mockReturnValue(createMockProcess(output));

    const result = await bridge.benchmark();
    expect(result.tokens_per_second).toBe(42.5);
    expect(result.latency_ms).toBe(1850);
  });
});

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
