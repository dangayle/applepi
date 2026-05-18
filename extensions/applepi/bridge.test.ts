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
