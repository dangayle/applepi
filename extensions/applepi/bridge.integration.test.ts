import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const BRIDGE_DIR = resolve(import.meta.dirname, "../../bridge");
const BINARY_PATH = resolve(BRIDGE_DIR, ".build/release/applepi-bridge");

/**
 * Integration test: verifies the Swift bridge actually compiles.
 *
 * This catches API mismatches against the FoundationModels SDK that
 * unit tests miss (since they mock the bridge binary).
 *
 * Skipped when Swift is not available (e.g. Linux CI).
 */
const hasSwift = (() => {
  try {
    execSync("swift --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasSwift)("Swift bridge build", () => {
  test("swift build -c release succeeds", () => {
    // This is the exact command `pnpm run bridge:build` runs
    execSync("swift build -c release", {
      cwd: BRIDGE_DIR,
      stdio: "pipe",
      timeout: 120_000,
    });

    expect(existsSync(BINARY_PATH)).toBe(true);
  }, 120_000);

  test("bridge --check returns valid JSON", () => {
    const output = execSync(`${BINARY_PATH} --check`, {
      stdio: "pipe",
      timeout: 10_000,
    });
    const parsed = JSON.parse(output.toString());
    expect(parsed).toHaveProperty("available");
    expect(typeof parsed.available).toBe("boolean");
  });

  test("bridge --context-size returns 4096", () => {
    const output = execSync(`${BINARY_PATH} --context-size`, {
      stdio: "pipe",
      timeout: 10_000,
    });
    const parsed = JSON.parse(output.toString());
    expect(parsed.context_size).toBe(4096);
  });

  test("bridge --token-count estimates tokens from stdin", () => {
    const output = execSync(`echo "hello world" | ${BINARY_PATH} --token-count`, {
      stdio: "pipe",
      shell: "/bin/bash",
      timeout: 10_000,
    });
    const parsed = JSON.parse(output.toString());
    expect(parsed.token_count).toBeGreaterThan(0);
    expect(typeof parsed.token_count).toBe("number");
  });
});
