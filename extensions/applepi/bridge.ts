import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import type {
  BridgeInput,
  BridgeOutput,
  BridgeStreamEvent,
  BridgeBenchmarkOutput,
  BridgeAvailabilityOutput,
  BridgeContextSizeOutput,
  BridgeTokenCountOutput,
} from "./types.js";
import { BRIDGE_EXIT_CODES, bridgeErrorMessage } from "./types.js";

export class BridgeManager {
  private static readonly TIMEOUT_MS = 30_000;
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

  /** Spawns the bridge binary and collects stdout/stderr */
  private spawnBridge(
    args: string[],
    stdinData?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  private handleResult<T>(
    stdout: string,
    stderr: string,
    exitCode: number
  ): T {
    if (exitCode !== 0) {
      let errorCode = BRIDGE_EXIT_CODES[exitCode] ?? "unknown";

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
      throw new Error(
        `Failed to parse bridge output: ${stdout.slice(0, 200)}`
      );
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
    const { stdout, stderr, exitCode } = await this.spawnBridge([
      "--benchmark",
    ]);
    return this.handleResult<BridgeBenchmarkOutput>(stdout, stderr, exitCode);
  }

  /** Returns the model's context window size in tokens */
  async contextSize(): Promise<number> {
    const { stdout, stderr, exitCode } = await this.spawnBridge(["--context-size"]);
    const result = this.handleResult<BridgeContextSizeOutput>(stdout, stderr, exitCode);
    return result.context_size;
  }

  /** Returns the token count for a given text string */
  async tokenCount(text: string): Promise<number> {
    const { stdout, stderr, exitCode } = await this.spawnBridge(
      ["--token-count"],
      text
    );
    const result = this.handleResult<BridgeTokenCountOutput>(stdout, stderr, exitCode);
    return result.token_count;
  }

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
}
