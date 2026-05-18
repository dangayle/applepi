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
