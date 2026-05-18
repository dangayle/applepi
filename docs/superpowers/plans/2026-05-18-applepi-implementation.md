# applepi Implementation Plan

> For agentic workers: REQUIRED: Use subagent-driven-development
> (if subagents available) or executing-plans to implement this plan.

Goal: Build a Pi package that exposes Apple's on-device FoundationModels as tools and a custom model provider.
Architecture: A Swift CLI bridge (`applepi-bridge`) wraps `LanguageModelSession` with JSON stdin/stdout. A TypeScript Pi extension manages the bridge lifecycle (build-on-first-use), registers three tools (`applepi_query`, `applepi_generate`, `applepi_benchmark`), and registers a custom `apple-intelligence` model provider with `streamSimple`. All communication is child-process spawning — no HTTP server.
Tech Stack: Swift 6.2 + FoundationModels framework, TypeScript + Pi Extension API (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`), typebox for schemas, vitest for tests.

---

## File Structure

```
applepi/
├── package.json                    # Pi package manifest, scripts, deps
├── tsconfig.json                   # TypeScript config (jiti loads .ts directly, but needed for type-checking)
├── vitest.config.ts                # Vitest configuration
├── README.md                       # User-facing docs
├── LICENSE                         # MIT license
├── AGENTS.md                       # Agent instructions for working in this repo
├── .gitignore                      # node_modules, .build, dist, etc.
├── extensions/
│   └── applepi/
│       ├── index.ts                # Extension entry: registers tools + provider
│       ├── index.test.ts           # Integration tests for the extension entry
│       ├── bridge.ts               # Swift bridge manager (check, build, spawn, communicate)
│       ├── bridge.test.ts          # Bridge manager unit tests
│       ├── provider.ts             # Custom model provider (streamSimple implementation)
│       ├── provider.test.ts        # Provider unit tests
│       ├── tools.ts                # Tool definitions (query, generate, benchmark)
│       ├── tools.test.ts           # Tool unit tests
│       ├── types.ts                # Shared TypeScript types (bridge input/output, errors)
│       └── README.md               # Extension docs with frontmatter
├── bridge/
│   ├── Package.swift               # SwiftPM manifest
│   └── Sources/
│       ├── main.swift              # Entry point: stdin parsing, arg dispatch
│       ├── Generation.swift        # LanguageModelSession respond + stream
│       ├── Schema.swift            # JSON Schema injection into system prompt (Tier 1)
│       ├── Benchmark.swift         # Fixed prompt benchmark
│       └── Models.swift            # Codable input/output JSON types
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-05-18-applepi-design.md
        └── plans/
            └── 2026-05-18-applepi-implementation.md   # This file
```

---

## Task 1: Project Scaffolding

**Depends on:** Nothing
**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `AGENTS.md`

- [ ] Step 1: Create `package.json`

```json
{
  "name": "applepi",
  "version": "0.1.0",
  "description": "On-device Apple Intelligence as a Pi tool and model provider",
  "keywords": ["pi-package"],
  "license": "MIT",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "bridge:build": "cd bridge && swift build -c release",
    "bridge:clean": "cd bridge && swift package clean"
  },
  "pi": {
    "extensions": ["./extensions/applepi/index.ts"]
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*",
    "@sinclair/typebox": "^0.34.0",
    "vitest": "^3.2.1",
    "typescript": "^5.8.0"
  }
}
```

- [ ] Step 2: Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["extensions/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] Step 3: Create `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/**/*.test.ts"],
    coverage: {
      include: ["extensions/**/*.ts"],
      exclude: ["extensions/**/*.test.ts"],
    },
  },
});
```

- [ ] Step 4: Create `.gitignore`

```
node_modules/
dist/
bridge/.build/
.DS_Store
*.swp
*.swo
coverage/
```

- [ ] Step 5: Create `LICENSE`

```
MIT License

Copyright (c) 2026 Dan Gayle

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] Step 6: Create `AGENTS.md`

```markdown
# applepi — Agent Instructions

This is a Pi package that exposes Apple's on-device FoundationModels as Pi tools and a custom model provider.

## Architecture

- `bridge/` — Swift CLI that wraps LanguageModelSession. JSON stdin → JSON stdout.
- `extensions/applepi/` — TypeScript Pi extension. Registers tools + provider, manages bridge lifecycle.

## Development

- `pnpm install` — install deps
- `pnpm test` — run vitest
- `pnpm run bridge:build` — compile Swift bridge
- Bridge binary lands at `bridge/.build/release/applepi-bridge`

## Conventions

- TDD: write failing test first, then implement
- All TypeScript in `extensions/applepi/`
- Types shared via `types.ts`
- Mock the bridge binary in tests — don't depend on Swift compiler in CI
- 100% branch coverage target
```

- [ ] Step 7: Install dependencies

Run: `cd /Users/dangayle/src/applepi && pnpm install`
Expected: Dependencies installed, `node_modules/` created, `pnpm-lock.yaml` generated

- [ ] Step 8: Verify vitest runs (no tests yet, but no errors)

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: "No test files found" or similar (0 tests, clean exit)

- [ ] Step 9: Commit

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore LICENSE AGENTS.md pnpm-lock.yaml
git commit -m "chore: scaffold project with package.json, tsconfig, vitest, and license"
```

---

## Task 2: Shared TypeScript Types

**Depends on:** Task 1
**Files:**
- Create: `extensions/applepi/types.ts`
- Create: `extensions/applepi/types.test.ts`

- [ ] Step 1: Write the test

```typescript
// extensions/applepi/types.test.ts
import { describe, test, expect } from "vitest";
import {
  type BridgeInput,
  type BridgeOutput,
  type BridgeStreamDelta,
  type BridgeStreamDone,
  type BridgeError,
  type BridgeBenchmarkOutput,
  type BridgeAvailabilityOutput,
  BRIDGE_EXIT_CODES,
  bridgeErrorMessage,
} from "./types.js";

describe("types", () => {
  describe("BRIDGE_EXIT_CODES", () => {
    test("maps all exit codes", () => {
      expect(BRIDGE_EXIT_CODES[0]).toBe("success");
      expect(BRIDGE_EXIT_CODES[1]).toBe("runtime_error");
      expect(BRIDGE_EXIT_CODES[2]).toBe("usage_error");
      expect(BRIDGE_EXIT_CODES[3]).toBe("guardrail_blocked");
      expect(BRIDGE_EXIT_CODES[4]).toBe("context_overflow");
      expect(BRIDGE_EXIT_CODES[5]).toBe("model_unavailable");
    });
  });

  describe("bridgeErrorMessage", () => {
    test("returns message for known error codes", () => {
      expect(bridgeErrorMessage("guardrail_blocked")).toBe(
        "Apple's safety guardrails blocked this request. Try rephrasing or using `permissive: true`."
      );
      expect(bridgeErrorMessage("context_overflow")).toBe(
        "Input too long for the 4096-token context window. Shorten the prompt."
      );
      expect(bridgeErrorMessage("model_unavailable")).toBe(
        "On-device model is unavailable. Enable Apple Intelligence in System Settings → Apple Intelligence & Siri."
      );
    });

    test("returns generic message for unknown error codes", () => {
      expect(bridgeErrorMessage("unknown")).toBe(
        "An unknown error occurred in the Apple Intelligence bridge."
      );
      expect(bridgeErrorMessage("runtime_error")).toBe(
        "An unknown error occurred in the Apple Intelligence bridge."
      );
    });
  });

  describe("type shapes (compile-time checks)", () => {
    test("BridgeInput accepts valid input", () => {
      const input: BridgeInput = {
        prompt: "hello",
        system_prompt: "be brief",
        stream: false,
        permissive: false,
        temperature: null,
        max_tokens: null,
        seed: null,
      };
      expect(input.prompt).toBe("hello");
    });

    test("BridgeInput accepts minimal input", () => {
      const input: BridgeInput = { prompt: "hello" };
      expect(input.prompt).toBe("hello");
    });

    test("BridgeInput accepts schema for structured generation", () => {
      const input: BridgeInput = {
        prompt: "classify this",
        schema: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["low", "high"] },
          },
          required: ["severity"],
        },
      };
      expect(input.schema).toBeDefined();
    });

    test("BridgeOutput shape", () => {
      const output: BridgeOutput = {
        content: "Paris",
        prompt_tokens: 12,
        completion_tokens: 3,
        finish_reason: "stop",
      };
      expect(output.content).toBe("Paris");
    });

    test("BridgeOutput with structured field", () => {
      const output: BridgeOutput = {
        content: '{"severity":"high"}',
        structured: { severity: "high" },
        prompt_tokens: 18,
        completion_tokens: 12,
        finish_reason: "stop",
      };
      expect(output.structured).toEqual({ severity: "high" });
    });

    test("BridgeStreamDelta shape", () => {
      const delta: BridgeStreamDelta = { type: "delta", content: "Par" };
      expect(delta.type).toBe("delta");
    });

    test("BridgeStreamDone shape", () => {
      const done: BridgeStreamDone = {
        type: "done",
        content: "Paris",
        prompt_tokens: 12,
        completion_tokens: 3,
        finish_reason: "stop",
      };
      expect(done.type).toBe("done");
    });

    test("BridgeError shape", () => {
      const error: BridgeError = {
        error: "guardrail_blocked",
        message: "blocked",
      };
      expect(error.error).toBe("guardrail_blocked");
    });

    test("BridgeBenchmarkOutput shape", () => {
      const bench: BridgeBenchmarkOutput = {
        available: true,
        tokens_per_second: 42.5,
        latency_ms: 1850,
        prompt_tokens: 8,
        completion_tokens: 78,
      };
      expect(bench.available).toBe(true);
    });

    test("BridgeAvailabilityOutput shape", () => {
      const avail: BridgeAvailabilityOutput = {
        available: false,
        reason: "apple_intelligence_not_enabled",
      };
      expect(avail.available).toBe(false);
    });
  });
});
```

- [ ] Step 2: Run test to verify it fails

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — cannot find module `./types.js`

- [ ] Step 3: Write the implementation

```typescript
// extensions/applepi/types.ts

/** Input JSON sent to the Swift bridge via stdin */
export interface BridgeInput {
  prompt: string;
  system_prompt?: string;
  stream?: boolean;
  permissive?: boolean;
  temperature?: number | null;
  max_tokens?: number | null;
  seed?: number | null;
  schema?: Record<string, unknown>;
}

/** Output JSON from the Swift bridge (non-streaming) */
export interface BridgeOutput {
  content: string;
  structured?: Record<string, unknown>;
  prompt_tokens: number;
  completion_tokens: number;
  finish_reason: string;
}

/** Streaming delta (NDJSON line) */
export interface BridgeStreamDelta {
  type: "delta";
  content: string;
}

/** Streaming done (final NDJSON line) */
export interface BridgeStreamDone {
  type: "done";
  content: string;
  prompt_tokens: number;
  completion_tokens: number;
  finish_reason: string;
}

/** Union type for all streaming events */
export type BridgeStreamEvent = BridgeStreamDelta | BridgeStreamDone;

/** Error JSON from the Swift bridge (stderr) */
export interface BridgeError {
  error: string;
  message: string;
}

/** Benchmark output */
export interface BridgeBenchmarkOutput {
  available: boolean;
  tokens_per_second: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/** Availability check output */
export interface BridgeAvailabilityOutput {
  available: boolean;
  reason: string | null;
}

/** Maps bridge exit codes to error names */
export const BRIDGE_EXIT_CODES: Record<number, string> = {
  0: "success",
  1: "runtime_error",
  2: "usage_error",
  3: "guardrail_blocked",
  4: "context_overflow",
  5: "model_unavailable",
};

/** User-facing error messages for bridge error codes */
const ERROR_MESSAGES: Record<string, string> = {
  guardrail_blocked:
    "Apple's safety guardrails blocked this request. Try rephrasing or using `permissive: true`.",
  context_overflow:
    "Input too long for the 4096-token context window. Shorten the prompt.",
  model_unavailable:
    "On-device model is unavailable. Enable Apple Intelligence in System Settings → Apple Intelligence & Siri.",
  device_not_eligible:
    "This device doesn't support Apple Intelligence. Requires Apple Silicon (M1+) with macOS 26+.",
  timeout:
    "On-device model timed out (30s). The model may be loading — try again.",
};

const DEFAULT_ERROR_MESSAGE =
  "An unknown error occurred in the Apple Intelligence bridge.";

/** Returns a user-facing error message for a bridge error code */
export function bridgeErrorMessage(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR_MESSAGE;
}
```

- [ ] Step 4: Run test to verify it passes

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests in types.test.ts)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/types.ts extensions/applepi/types.test.ts
git commit -m "feat: add shared TypeScript types for bridge communication"
```

---

## Task 3: Bridge Manager — Availability & Build

**Depends on:** Task 2
**Files:**
- Create: `extensions/applepi/bridge.ts`
- Create: `extensions/applepi/bridge.test.ts`

This task covers the bridge manager's `check()`, `ensureBinary()`, and `getBinaryPath()` methods. Spawning and communication come in Task 4.

- [ ] Step 1: Write the failing test

```typescript
// extensions/applepi/bridge.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { BridgeManager } from "./bridge.js";

// Mock fs and child_process
vi.mock("node:fs");
vi.mock("node:child_process");

const mockedFs = vi.mocked(fs);
const mockedCp = vi.mocked(childProcess);

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
```

- [ ] Step 2: Run test to verify it fails

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — cannot find module `./bridge.js`

- [ ] Step 3: Write the implementation

```typescript
// extensions/applepi/bridge.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import type {
  BridgeInput,
  BridgeOutput,
  BridgeStreamEvent,
  BridgeBenchmarkOutput,
  BridgeAvailabilityOutput,
} from "./types.js";
import { BRIDGE_EXIT_CODES, bridgeErrorMessage } from "./types.js";

export class BridgeManager {
  private readonly bridgeDir: string;

  constructor(bridgeDir: string) {
    this.bridgeDir = bridgeDir;
  }

  /** Returns the path to the compiled bridge binary */
  getBinaryPath(): string {
    return path.join(this.bridgeDir, ".build", "release", "applepi-bridge");
  }

  /** Checks if the bridge binary has been compiled */
  isBinaryBuilt(): boolean {
    return fs.existsSync(this.getBinaryPath());
  }

  /** Compiles the Swift bridge. Throws with actionable errors on failure. */
  build(): void {
    try {
      childProcess.execSync("swift build -c release", {
        cwd: this.bridgeDir,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err: unknown) {
      const error = err as Error & {
        status?: number;
        stderr?: Buffer;
      };

      if (error.status === 127) {
        throw new Error(
          "applepi requires Swift to compile the Apple Intelligence bridge. " +
            "Install Xcode Command Line Tools: `xcode-select --install`"
        );
      }

      const stderr = error.stderr?.toString() ?? error.message;
      throw new Error(
        `Failed to compile the Swift bridge. Check \`swift --version\` output.\n${stderr}`
      );
    }
  }

  /** Ensures the bridge binary exists, building it if needed */
  ensureBinary(): void {
    if (!this.isBinaryBuilt()) {
      this.build();
    }
  }
}
```

- [ ] Step 4: Run test to verify it passes

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests in bridge.test.ts and types.test.ts)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/bridge.ts extensions/applepi/bridge.test.ts
git commit -m "feat: add bridge manager with build-on-first-use"
```

---

## Task 4: Bridge Manager — Spawn & Communicate

**Depends on:** Task 3
**Files:**
- Modify: `extensions/applepi/bridge.ts`
- Modify: `extensions/applepi/bridge.test.ts`

This task adds `run()`, `stream()`, `check()`, and `benchmark()` methods that spawn the bridge binary and parse its output.

- [ ] Step 1: Write the failing tests

Append to `extensions/applepi/bridge.test.ts`:

```typescript
// --- Add these imports at the top if not already present ---
// import { Readable, Writable } from "node:stream";
// import type { ChildProcess } from "node:child_process";

import { Readable, Writable, PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

// Helper to create a mock child process
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
        // Emit close after stdout/stderr are consumed
        setTimeout(() => cb(exitCode), 10);
      }
      return proc;
    }),
    kill: vi.fn(),
  } as unknown as ChildProcess;
  return proc;
}

describe("BridgeManager — run", () => {
  let bridge: BridgeManager;

  beforeEach(() => {
    bridge = new BridgeManager("/fake/bridge");
    vi.clearAllMocks();
    // Assume binary exists for run tests
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
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — `bridge.run` / `bridge.check` / `bridge.benchmark` are not functions

- [ ] Step 3: Add `run()`, `check()`, and `benchmark()` to the bridge manager

Add these methods to the `BridgeManager` class in `extensions/applepi/bridge.ts`:

```typescript
  private static readonly TIMEOUT_MS = 30_000;

  /** Spawns the bridge binary and collects stdout/stderr */
  private spawnBridge(args: string[], stdinData?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      this.ensureBinary();

      const proc = childProcess.spawn(this.getBinaryPath(), args, {
        cwd: this.bridgeDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, BridgeManager.TIMEOUT_MS);

      proc.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      if (stdinData) {
        proc.stdin!.write(stdinData);
        proc.stdin!.end();
      }

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(bridgeErrorMessage("timeout")));
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn bridge: ${err.message}`));
      });
    });
  }

  /** Parses bridge output, throwing on errors */
  private handleResult<T>(stdout: string, stderr: string, exitCode: number): T {
    if (exitCode !== 0) {
      let errorCode = BRIDGE_EXIT_CODES[exitCode] ?? "unknown";

      // Try to parse stderr for a structured error
      try {
        const parsed = JSON.parse(stderr);
        if (parsed.error) {
          errorCode = parsed.error;
        }
      } catch {
        // stderr wasn't JSON, use exit code mapping
      }

      throw new Error(bridgeErrorMessage(errorCode));
    }

    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new Error(`Failed to parse bridge output: ${stdout.slice(0, 200)}`);
    }
  }

  /** Runs a generation request (non-streaming) */
  async run(input: BridgeInput): Promise<BridgeOutput> {
    const { stdout, stderr, exitCode } = await this.spawnBridge(
      [],
      JSON.stringify(input)
    );
    return this.handleResult<BridgeOutput>(stdout, stderr, exitCode);
  }

  /** Checks model availability */
  async check(): Promise<BridgeAvailabilityOutput> {
    const { stdout, stderr, exitCode } = await this.spawnBridge(["--check"]);
    return this.handleResult<BridgeAvailabilityOutput>(stdout, stderr, exitCode);
  }

  /** Runs a performance benchmark */
  async benchmark(): Promise<BridgeBenchmarkOutput> {
    const { stdout, stderr, exitCode } = await this.spawnBridge(["--benchmark"]);
    return this.handleResult<BridgeBenchmarkOutput>(stdout, stderr, exitCode);
  }
```

Also add to the imports at the top of `bridge.ts` (if not already there):

```typescript
import type {
  BridgeInput,
  BridgeOutput,
  BridgeStreamEvent,
  BridgeBenchmarkOutput,
  BridgeAvailabilityOutput,
} from "./types.js";
import { BRIDGE_EXIT_CODES, bridgeErrorMessage } from "./types.js";
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests in bridge.test.ts)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/bridge.ts extensions/applepi/bridge.test.ts
git commit -m "feat: add bridge spawn, run, check, and benchmark methods"
```

---

## Task 5: Tool Definitions

**Depends on:** Task 4
**Files:**
- Create: `extensions/applepi/tools.ts`
- Create: `extensions/applepi/tools.test.ts`

- [ ] Step 1: Write the failing test

```typescript
// extensions/applepi/tools.test.ts
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
      // Result should contain the structured JSON
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
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — cannot find module `./tools.js`

- [ ] Step 3: Write the implementation

```typescript
// extensions/applepi/tools.ts
import { Type } from "typebox";
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
      stream: Type.Optional(
        Type.Boolean({
          description: "Stream response token-by-token",
          default: false,
        })
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const input: BridgeInput = {
          prompt: params.prompt,
          system_prompt: params.system_prompt,
          stream: params.stream ?? false,
          permissive: params.permissive,
          temperature: params.temperature ?? null,
          max_tokens: params.max_tokens ?? null,
        };
        const result = await bridge.run(input);
        return textResult(result.content, {
          prompt_tokens: result.prompt_tokens,
          completion_tokens: result.completion_tokens,
          finish_reason: result.finish_reason,
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
      try {
        const input: BridgeInput = {
          prompt: params.prompt,
          schema: params.schema,
          system_prompt: params.system_prompt,
          permissive: params.permissive,
        };
        const result = await bridge.run(input);

        // If structured output was returned, format it nicely
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
      try {
        const result = await bridge.benchmark();
        const lines = [
          `Available: ${result.available}`,
          `Tokens/sec: ${result.tokens_per_second}`,
          `Latency: ${result.latency_ms}ms`,
          `Prompt tokens: ${result.prompt_tokens}`,
          `Completion tokens: ${result.completion_tokens}`,
        ];
        return textResult(lines.join("\n"), result);
    },
  };

  return [queryTool, generateTool, benchmarkTool];
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/tools.ts extensions/applepi/tools.test.ts
git commit -m "feat: add tool definitions for query, generate, and benchmark"
```

---

## Task 6: Custom Model Provider

**Depends on:** Task 4
**Files:**
- Create: `extensions/applepi/provider.ts`
- Create: `extensions/applepi/provider.test.ts`

The provider uses Pi's `registerProvider()` with a `streamSimple` function that spawns the bridge in streaming mode and emits `AssistantMessageEventStream` events.

- [ ] Step 1: Write the failing test

```typescript
// extensions/applepi/provider.test.ts
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
    const model = config.models![0];
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

    // Mock the bridge.run to return a response
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

    const stream = config.streamSimple!(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events[0].type).toBe("start");
    expect(events.find((e) => e.type === "text_start")).toBeTruthy();
    expect(events.find((e) => e.type === "text_end")).toBeTruthy();
    expect(events.find((e) => e.type === "done")).toBeTruthy();

    const doneEvent = events.find((e) => e.type === "done");
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

    const stream = config.streamSimple!(model, context);

    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeTruthy();
    expect(errorEvent.error.errorMessage).toContain("Model unavailable");
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

    const stream = config.streamSimple!(model, context);
    const events: any[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Verify the bridge received the last user message
    expect(mockBridge.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Second message",
        system_prompt: "You are helpful",
      })
    );
  });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — cannot find module `./provider.js`

- [ ] Step 3: Write the implementation

```typescript
// extensions/applepi/provider.ts
import {
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import type { BridgeManager } from "./bridge.js";
import type { BridgeInput } from "./types.js";

/** Extracts the last user message text from the Pi message array */
function extractPrompt(messages: Context["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      // Array of content blocks — extract text
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
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
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
      const input: BridgeInput = {
        prompt,
        system_prompt: context.systemPrompt || undefined,
      };

      const result = await bridge.run(input);

      // Update usage
      output.usage.input = result.prompt_tokens;
      output.usage.output = result.completion_tokens;
      output.usage.totalTokens = result.prompt_tokens + result.completion_tokens;

      // Emit text content
      output.content.push({ type: "text", text: result.content });
      const contentIndex = 0;

      stream.push({ type: "text_start", contentIndex, partial: output });
      stream.push({
        type: "text_delta",
        contentIndex,
        delta: result.content,
        partial: output,
      });
      stream.push({
        type: "text_end",
        contentIndex,
        content: result.content,
        partial: output,
      });

      stream.push({
        type: "done",
        reason: "stop",
        message: output,
      });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
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
    api: "apple-intelligence-api" as any,
    models: [
      {
        id: "apple-intelligence",
        name: "Apple Intelligence (on-device)",
        reasoning: false,
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 4096,
      },
    ],
    streamSimple: (
      model: Model<any>,
      context: Context,
      options?: SimpleStreamOptions
    ) => streamAppleIntelligence(bridge, model, context, options),
  };
}
```

- [ ] Step 4: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests)

- [ ] Step 5: Commit

```bash
git add extensions/applepi/provider.ts extensions/applepi/provider.test.ts
git commit -m "feat: add custom Apple Intelligence model provider"
```

---

## Task 7: Extension Entry Point

**Depends on:** Task 5, Task 6
**Files:**
- Create: `extensions/applepi/index.ts`
- Create: `extensions/applepi/index.test.ts`
- Create: `extensions/applepi/README.md`

- [ ] Step 1: Write the failing test

```typescript
// extensions/applepi/index.test.ts
import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the dependencies before importing the module
vi.mock("./bridge.js", () => ({
  BridgeManager: vi.fn().mockImplementation(() => ({
    run: vi.fn(),
    check: vi.fn(),
    benchmark: vi.fn(),
    ensureBinary: vi.fn(),
    getBinaryPath: vi.fn().mockReturnValue("/fake/path"),
    isBinaryBuilt: vi.fn().mockReturnValue(true),
    build: vi.fn(),
  })),
}));

vi.mock("./tools.js", () => ({
  createTools: vi.fn().mockReturnValue([
    { name: "applepi_query", label: "Query", description: "query", parameters: {}, execute: vi.fn() },
    { name: "applepi_generate", label: "Generate", description: "generate", parameters: {}, execute: vi.fn() },
    { name: "applepi_benchmark", label: "Benchmark", description: "benchmark", parameters: {}, execute: vi.fn() },
  ]),
}));

vi.mock("./provider.js", () => ({
  createProviderConfig: vi.fn().mockReturnValue({
    name: "Apple Intelligence",
    api: "apple-intelligence-api",
    models: [{ id: "apple-intelligence" }],
    streamSimple: vi.fn(),
  }),
}));

describe("extension entry point", () => {
  let registerToolCalls: any[];
  let registerProviderCalls: any[];
  let mockPi: any;

  beforeEach(async () => {
    registerToolCalls = [];
    registerProviderCalls = [];

    mockPi = {
      registerTool: vi.fn((tool: any) => registerToolCalls.push(tool)),
      registerProvider: vi.fn((name: string, config: any) =>
        registerProviderCalls.push({ name, config })
      ),
      on: vi.fn(),
    };

    // Re-import to re-run the module
    vi.resetModules();
    // Re-apply mocks after resetModules
    vi.doMock("./bridge.js", () => ({
      BridgeManager: vi.fn().mockImplementation(() => ({
        run: vi.fn(),
        check: vi.fn(),
        benchmark: vi.fn(),
        ensureBinary: vi.fn(),
        getBinaryPath: vi.fn().mockReturnValue("/fake/path"),
        isBinaryBuilt: vi.fn().mockReturnValue(true),
        build: vi.fn(),
      })),
    }));

    vi.doMock("./tools.js", () => ({
      createTools: vi.fn().mockReturnValue([
        { name: "applepi_query", label: "Query", description: "query", parameters: {}, execute: vi.fn() },
        { name: "applepi_generate", label: "Generate", description: "generate", parameters: {}, execute: vi.fn() },
        { name: "applepi_benchmark", label: "Benchmark", description: "benchmark", parameters: {}, execute: vi.fn() },
      ]),
    }));

    vi.doMock("./provider.js", () => ({
      createProviderConfig: vi.fn().mockReturnValue({
        name: "Apple Intelligence",
        api: "apple-intelligence-api",
        models: [{ id: "apple-intelligence" }],
        streamSimple: vi.fn(),
      }),
    }));

    const mod = await import("./index.js");
    mod.default(mockPi);
  });

  test("registers three tools", () => {
    expect(mockPi.registerTool).toHaveBeenCalledTimes(3);
  });

  test("registers the applepi_query tool", () => {
    expect(registerToolCalls.find((t) => t.name === "applepi_query")).toBeTruthy();
  });

  test("registers the applepi_generate tool", () => {
    expect(registerToolCalls.find((t) => t.name === "applepi_generate")).toBeTruthy();
  });

  test("registers the applepi_benchmark tool", () => {
    expect(registerToolCalls.find((t) => t.name === "applepi_benchmark")).toBeTruthy();
  });

  test("registers the apple-intelligence provider", () => {
    expect(mockPi.registerProvider).toHaveBeenCalledWith(
      "apple-intelligence",
      expect.objectContaining({ name: "Apple Intelligence" })
    );
  });
});
```

- [ ] Step 2: Run tests to verify they fail

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: FAIL — cannot find module `./index.js`

- [ ] Step 3: Write the implementation

```typescript
// extensions/applepi/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeManager } from "./bridge.js";
import { createTools } from "./tools.js";
import { createProviderConfig } from "./provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function applepi(pi: ExtensionAPI) {
  // Bridge source lives two dirs up from extensions/applepi/
  const bridgeDir = path.resolve(__dirname, "../../bridge");
  const bridge = new BridgeManager(bridgeDir);

  // Register tools
  const tools = createTools(bridge);
  for (const tool of tools) {
    pi.registerTool(tool);
  }

  // Register custom provider
  const providerConfig = createProviderConfig(bridge);
  pi.registerProvider("apple-intelligence", providerConfig);
}
```

- [ ] Step 4: Create `extensions/applepi/README.md`

```markdown
---
name: applepi
description: On-device Apple Intelligence as a Pi tool and model provider
---

# applepi

Exposes Apple's on-device AI model to Pi via three tools and a custom model provider.

## Tools

- **applepi_query** — General-purpose text generation (summarization, classification, naming, brainstorming)
- **applepi_generate** — Structured JSON output guided by a JSON Schema
- **applepi_benchmark** — Performance metrics for the on-device model

## Model Provider

Use `/model apple-intelligence` to select the on-device model for the current session.

## Requirements

- macOS 26+ (Tahoe)
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
- Swift toolchain (Xcode or Command Line Tools)
```

- [ ] Step 5: Run tests to verify they pass

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests)

- [ ] Step 6: Commit

```bash
git add extensions/applepi/index.ts extensions/applepi/index.test.ts extensions/applepi/README.md
git commit -m "feat: add extension entry point — registers tools and provider"
```

---

## Task 8: Swift Bridge — Package.swift & Models

**Depends on:** Task 1
**Files:**
- Create: `bridge/Package.swift`
- Create: `bridge/Sources/Models.swift`

- [ ] Step 1: Create `bridge/Package.swift`

```swift
// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "applepi-bridge",
    platforms: [
        .macOS(.v26)
    ],
    targets: [
        .executableTarget(
            name: "applepi-bridge",
            path: "Sources",
            swiftSettings: [
                .enableExperimentalFeature("Macros")
            ]
        )
    ]
)
```

- [ ] Step 2: Create `bridge/Sources/Models.swift`

```swift
// bridge/Sources/Models.swift
import Foundation

/// Input JSON from TypeScript layer via stdin
struct BridgeInput: Codable {
    let prompt: String
    var systemPrompt: String?
    var stream: Bool?
    var permissive: Bool?
    var temperature: Double?
    var maxTokens: Int?
    var seed: Int?
    var schema: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case prompt
        case systemPrompt = "system_prompt"
        case stream
        case permissive
        case temperature
        case maxTokens = "max_tokens"
        case seed
        case schema
    }
}

/// Output JSON for non-streaming responses
struct BridgeOutput: Codable {
    let content: String
    var structured: [String: AnyCodable]?
    let promptTokens: Int
    let completionTokens: Int
    let finishReason: String

    enum CodingKeys: String, CodingKey {
        case content
        case structured
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case finishReason = "finish_reason"
    }
}

/// Streaming delta event
struct StreamDelta: Codable {
    let type: String // "delta"
    let content: String
}

/// Streaming done event
struct StreamDone: Codable {
    let type: String // "done"
    let content: String
    let promptTokens: Int
    let completionTokens: Int
    let finishReason: String

    enum CodingKeys: String, CodingKey {
        case type, content
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case finishReason = "finish_reason"
    }
}

/// Error output (written to stderr)
struct BridgeErrorOutput: Codable {
    let error: String
    let message: String
}

/// Benchmark output
struct BenchmarkOutput: Codable {
    let available: Bool
    let tokensPerSecond: Double
    let latencyMs: Int
    let promptTokens: Int
    let completionTokens: Int

    enum CodingKeys: String, CodingKey {
        case available
        case tokensPerSecond = "tokens_per_second"
        case latencyMs = "latency_ms"
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
    }
}

/// Availability check output
struct AvailabilityOutput: Codable {
    let available: Bool
    let reason: String?
}

// MARK: - AnyCodable helper for arbitrary JSON

/// A type-erased Codable wrapper for encoding/decoding arbitrary JSON
struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON type")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }
}

// MARK: - Error type

enum BridgeError: Error {
    case usage(String)
    case guardrailBlocked(String)
    case contextOverflow(String)
    case modelUnavailable(String)
    case runtime(String)
}

// MARK: - JSON helpers

let jsonEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
}()

let jsonDecoder = JSONDecoder()

func writeJSON<T: Encodable>(_ value: T, to fileHandle: FileHandle = .standardOutput) {
    guard let data = try? jsonEncoder.encode(value) else { return }
    fileHandle.write(data)
    fileHandle.write("\n".data(using: .utf8)!)
}

func writeError(_ code: String, _ message: String) {
    let error = BridgeErrorOutput(error: code, message: message)
    guard let data = try? jsonEncoder.encode(error) else { return }
    FileHandle.standardError.write(data)
    FileHandle.standardError.write("\n".data(using: .utf8)!)
}
```

- [ ] Step 3: Verify it compiles (create a minimal main.swift to test)

Create a temporary `bridge/Sources/main.swift`:

```swift
// bridge/Sources/main.swift
import Foundation

// Placeholder — will be replaced in Tasks 9-11
print("applepi-bridge placeholder")
```

Run: `cd /Users/dangayle/src/applepi/bridge && swift build 2>&1 | tail -5`
Expected: Build succeeds (possibly with warnings about macOS 26)

- [ ] Step 4: Commit

```bash
git add bridge/Package.swift bridge/Sources/Models.swift bridge/Sources/main.swift
git commit -m "feat: add Swift bridge Package.swift and Codable models"
```

---

## Task 9: Swift Bridge — Generation

**Depends on:** Task 8
**Files:**
- Create: `bridge/Sources/Generation.swift`

- [ ] Step 1: Write the implementation

```swift
// bridge/Sources/Generation.swift
import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum Generation {

    /// Performs a non-streaming generation request
    static func respond(input: BridgeInput) async throws -> BridgeOutput {
        let instructions: Instructions? = input.systemPrompt.map { Instructions($0) }
        let session: LanguageModelSession
        if let instructions {
            session = LanguageModelSession(instructions: instructions)
        } else {
            session = LanguageModelSession()
        }

        let prompt = input.prompt
        let response = try await session.respond(to: prompt)

        return BridgeOutput(
            content: response.content,
            structured: nil,
            promptTokens: 0, // Apple doesn't expose token counts directly
            completionTokens: 0,
            finishReason: "stop"
        )
    }

    /// Performs a streaming generation request, writing NDJSON to stdout
    static func stream(input: BridgeInput) async throws {
        let instructions: Instructions? = input.systemPrompt.map { Instructions($0) }
        let session: LanguageModelSession
        if let instructions {
            session = LanguageModelSession(instructions: instructions)
        } else {
            session = LanguageModelSession()
        }

        let prompt = input.prompt
        var fullContent = ""

        let responseStream = session.streamResponse(to: prompt)
        for try await partial in responseStream {
            let newContent = partial.content
            if newContent.count > fullContent.count {
                let delta = String(newContent.dropFirst(fullContent.count))
                let event = StreamDelta(type: "delta", content: delta)
                writeJSON(event)
                fullContent = newContent
            }
        }

        let done = StreamDone(
            type: "done",
            content: fullContent,
            promptTokens: 0,
            completionTokens: 0,
            finishReason: "stop"
        )
        writeJSON(done)
    }
}
```

- [ ] Step 2: Verify it compiles

Run: `cd /Users/dangayle/src/applepi/bridge && swift build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] Step 3: Commit

```bash
git add bridge/Sources/Generation.swift
git commit -m "feat: add Swift generation module (respond + stream)"
```

---

## Task 10: Swift Bridge — Schema & Benchmark

**Depends on:** Task 9
**Files:**
- Create: `bridge/Sources/Schema.swift`
- Create: `bridge/Sources/Benchmark.swift`

- [ ] Step 1: Write `bridge/Sources/Schema.swift`

```swift
// bridge/Sources/Schema.swift
import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum SchemaGeneration {

    /// Generates structured JSON output by injecting the schema into the system prompt
    /// This is Tier 1: prompt-based JSON mode
    static func generate(input: BridgeInput) async throws -> BridgeOutput {
        guard let schema = input.schema else {
            throw BridgeError.usage("schema field is required for structured generation")
        }

        // Serialize the schema to include in the system prompt
        let schemaData = try jsonEncoder.encode(schema.mapValues { AnyCodable($0) })
        let schemaString = String(data: schemaData, encoding: .utf8) ?? "{}"

        let systemPrompt = """
        \(input.systemPrompt ?? "You are a helpful assistant.")

        IMPORTANT: You must respond with ONLY valid JSON matching this schema. No markdown, no explanation, no code fences. Just raw JSON.

        JSON Schema:
        \(schemaString)
        """

        let instructions = Instructions(systemPrompt)
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: input.prompt)

        let content = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        // Try to parse as JSON to populate the structured field
        var structured: [String: AnyCodable]? = nil
        if let data = content.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            structured = dict.mapValues { AnyCodable($0) }
        }

        return BridgeOutput(
            content: content,
            structured: structured,
            promptTokens: 0,
            completionTokens: 0,
            finishReason: "stop"
        )
    }
}
```

- [ ] Step 2: Write `bridge/Sources/Benchmark.swift`

```swift
// bridge/Sources/Benchmark.swift
import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum Benchmark {

    private static let fixedPrompt = "Explain what a compiler does in three sentences."

    static func run() async -> BenchmarkOutput {
        // Check availability first
        let availability = SystemLanguageModel.default.availability
        guard case .available = availability else {
            return BenchmarkOutput(
                available: false,
                tokensPerSecond: 0,
                latencyMs: 0,
                promptTokens: 0,
                completionTokens: 0
            )
        }

        let session = LanguageModelSession()
        let startTime = DispatchTime.now()

        do {
            let response = try await session.respond(to: fixedPrompt)
            let endTime = DispatchTime.now()

            let elapsedNs = endTime.uptimeNanoseconds - startTime.uptimeNanoseconds
            let elapsedMs = Int(elapsedNs / 1_000_000)

            // Rough token estimate: ~4 chars per token
            let estimatedTokens = response.content.count / 4
            let tokensPerSecond = elapsedMs > 0
                ? Double(estimatedTokens) / (Double(elapsedMs) / 1000.0)
                : 0

            return BenchmarkOutput(
                available: true,
                tokensPerSecond: (tokensPerSecond * 10).rounded() / 10, // 1 decimal
                latencyMs: elapsedMs,
                promptTokens: fixedPrompt.count / 4,
                completionTokens: estimatedTokens
            )
        } catch {
            return BenchmarkOutput(
                available: false,
                tokensPerSecond: 0,
                latencyMs: 0,
                promptTokens: 0,
                completionTokens: 0
            )
        }
    }
}

@available(macOS 26.0, *)
enum AvailabilityCheck {

    static func check() -> AvailabilityOutput {
        let availability = SystemLanguageModel.default.availability
        switch availability {
        case .available:
            return AvailabilityOutput(available: true, reason: nil)
        case .unavailable(let reason):
            let reasonString: String
            switch reason {
            case .appleIntelligenceNotEnabled:
                reasonString = "apple_intelligence_not_enabled"
            case .deviceNotEligible:
                reasonString = "device_not_eligible"
            default:
                reasonString = "unknown"
            }
            return AvailabilityOutput(available: false, reason: reasonString)
        default:
            return AvailabilityOutput(available: false, reason: "unknown")
        }
    }
}
```

- [ ] Step 3: Verify it compiles

Run: `cd /Users/dangayle/src/applepi/bridge && swift build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] Step 4: Commit

```bash
git add bridge/Sources/Schema.swift bridge/Sources/Benchmark.swift
git commit -m "feat: add Swift schema generation (Tier 1) and benchmark modules"
```

---

## Task 11: Swift Bridge — Main Entry Point

**Depends on:** Task 9, Task 10
**Files:**
- Modify: `bridge/Sources/main.swift`

- [ ] Step 1: Write the implementation (replace the placeholder)

```swift
// bridge/Sources/main.swift
import Foundation
import FoundationModels

// MARK: - Exit codes

func exitWithCode(_ code: Int32, error: String? = nil, message: String? = nil) -> Never {
    if let error, let message {
        writeError(error, message)
    }
    exit(code)
}

// MARK: - stdin reader

func readStdin() -> String? {
    var input = ""
    while let line = readLine(strippingNewline: false) {
        input += line
    }
    return input.isEmpty ? nil : input
}

// MARK: - Main

@available(macOS 26.0, *)
func main() async {
    let args = CommandLine.arguments

    // --check: availability probe
    if args.contains("--check") {
        let result = AvailabilityCheck.check()
        writeJSON(result)
        exit(0)
    }

    // --benchmark: performance probe
    if args.contains("--benchmark") {
        let result = await Benchmark.run()
        writeJSON(result)
        exit(0)
    }

    // Default: generation mode — read input from stdin
    guard let stdinString = readStdin(),
          let stdinData = stdinString.data(using: .utf8) else {
        exitWithCode(2, error: "usage_error", message: "No input provided on stdin")
    }

    let input: BridgeInput
    do {
        input = try jsonDecoder.decode(BridgeInput.self, from: stdinData)
    } catch {
        exitWithCode(2, error: "usage_error", message: "Invalid JSON input: \(error.localizedDescription)")
    }

    do {
        if input.schema != nil {
            // Structured generation
            let result = try await SchemaGeneration.generate(input: input)
            writeJSON(result)
        } else if input.stream == true {
            // Streaming generation
            try await Generation.stream(input: input)
        } else {
            // Non-streaming generation
            let result = try await Generation.respond(input: input)
            writeJSON(result)
        }
    } catch let error as LanguageModelSession.GenerationError {
        switch error {
        case .guardrailViolation:
            exitWithCode(3, error: "guardrail_blocked",
                        message: "The request was blocked by Apple's safety guardrails.")
        case .exceededContextWindowSize:
            exitWithCode(4, error: "context_overflow",
                        message: "Input too long for the context window. Shorten the prompt.")
        case .assetsUnavailable:
            exitWithCode(5, error: "model_unavailable",
                        message: "The on-device model assets are not available.")
        case .rateLimited:
            exitWithCode(1, error: "rate_limited",
                        message: "On-device model is rate limited. Wait a moment and try again.")
        case .refusal:
            exitWithCode(3, error: "guardrail_blocked",
                        message: "The model refused this request.")
        case .concurrentRequests:
            exitWithCode(1, error: "concurrent_requests",
                        message: "Another generation is already in progress. Wait and retry.")
        case .unsupportedLanguageOrLocale:
            exitWithCode(1, error: "unsupported_locale",
                        message: "The current language or locale is not supported by the on-device model.")
        case .decodingFailure:
            exitWithCode(1, error: "decoding_failure",
                        message: "Failed to decode model output.")
        case .unsupportedGuide:
            exitWithCode(1, error: "unsupported_guide",
                        message: "The generation guide/schema is not supported.")
        @unknown default:
            exitWithCode(1, error: "unknown",
                        message: "Generation error: \(error.localizedDescription)")
        }
    } catch {
        exitWithCode(1, error: "unknown", message: "Unexpected error: \(error.localizedDescription)")
    }
}

// Entry point — check platform availability
if #available(macOS 26.0, *) {
    await main()
} else {
    writeError("model_unavailable", "applepi requires macOS 26 (Tahoe) or later")
    exit(5)
}
```

- [ ] Step 2: Verify it compiles

Run: `cd /Users/dangayle/src/applepi/bridge && swift build -c release 2>&1 | tail -5`
Expected: Build succeeds. Binary at `bridge/.build/release/applepi-bridge`

- [ ] Step 3: Verify `--check` flag works

Run: `cd /Users/dangayle/src/applepi/bridge && .build/release/applepi-bridge --check`
Expected: JSON output like `{"available":false,"reason":"apple_intelligence_not_enabled"}` or `{"available":true,"reason":null}` (depends on system config)

- [ ] Step 4: Verify usage error on empty stdin

Run: `echo "" | cd /Users/dangayle/src/applepi/bridge && echo "" | .build/release/applepi-bridge`
Expected: Exit code 2, stderr contains `usage_error`

- [ ] Step 5: Commit

```bash
git add bridge/Sources/main.swift
git commit -m "feat: add Swift bridge main entry point with dispatch"
```

---

## Task 12: README & Final Integration

**Depends on:** Task 7, Task 11
**Files:**
- Create: `README.md`

- [ ] Step 1: Write `README.md`

```markdown
# 🥧 applepi

> On-device Apple Intelligence as a Pi tool and model provider.
> Free, private, zero API keys. macOS 26+, Apple Silicon.

## Install

```bash
pi install github.com/dangayle/applepi
```

## What You Get

### Three Tools

| Tool | Purpose |
|------|---------|
| `applepi_query` | General-purpose on-device text generation |
| `applepi_generate` | Structured JSON output guided by a schema |
| `applepi_benchmark` | Performance metrics for the on-device model |

### Model Provider

Use Apple Intelligence like any other model in Pi:

```
/model apple-intelligence
```

Route lightweight tasks to the free on-device model, heavy tasks to Claude.

## Requirements

- macOS 26+ (Tahoe)
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
- Swift toolchain (Xcode or Command Line Tools)

## How It Works

`applepi` has two components:

1. **Swift Bridge** — A minimal CLI (`~100 lines`) wrapping Apple's `LanguageModelSession`. JSON in via stdin, JSON out via stdout. Built automatically on first use.

2. **Pi Extension** — TypeScript that registers tools and the model provider with Pi. Manages the Swift binary lifecycle, error handling, and output formatting.

No HTTP servers, no API keys, no code signing. The on-device model runs entirely on your Mac's Neural Engine.

## Development

```bash
git clone https://github.com/dangayle/applepi
cd applepi
pnpm install
pnpm test              # Run TypeScript tests
pnpm run bridge:build  # Compile Swift bridge
```

## Limitations

- **4096-token context window** (input + output combined)
- **No vision/image support**
- **Slower than cloud models** (a few seconds per response)
- **Apple's safety guardrails** may refuse some prompts — use `permissive: true` to reduce false positives

## License

MIT
```

- [ ] Step 2: Run full test suite one final time

Run: `cd /Users/dangayle/src/applepi && pnpm test`
Expected: PASS (all tests across all files)

- [ ] Step 3: Commit and push

```bash
git add README.md
git commit -m "docs: add README with installation and usage instructions"
git push origin main
```

---

## Task Dependency Graph

```
Task 1 (Scaffolding)
├── Task 2 (Types) ─────────────┐
│   ├── Task 3 (Bridge Build)   │
│   │   └── Task 4 (Bridge Run) │
│   │       ├── Task 5 (Tools) ─┤
│   │       └── Task 6 (Provider)│
│   │           └── Task 7 (Entry Point) ← depends on 5 + 6
│   └──────────────────────────────────────────────────────┘
├── Task 8 (Swift Package + Models)
│   └── Task 9 (Swift Generation)
│       └── Task 10 (Swift Schema + Benchmark)
│           └── Task 11 (Swift Main)
└── Task 12 (README) ← depends on 7 + 11
```

**Parallelizable groups:**
- Tasks 2-7 (TypeScript) and Tasks 8-11 (Swift) can be done in parallel since they don't touch the same files.
- Task 12 depends on both chains completing.
