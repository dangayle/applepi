import { describe, test, expect } from "vitest";
import {
  type BridgeInput,
  type BridgeOutput,
  type BridgeStreamDelta,
  type BridgeStreamDone,
  type BridgeError,
  type BridgeBenchmarkOutput,
  type BridgeAvailabilityOutput,
  type BridgeContextSizeOutput,
  type BridgeTokenCountOutput,
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

    test("returns message for rate_limited error code", () => {
      expect(bridgeErrorMessage("rate_limited")).toBe(
        "On-device model is rate limited. Wait a moment and try again."
      );
    });

    test("returns message for concurrent_requests error code", () => {
      expect(bridgeErrorMessage("concurrent_requests")).toBe(
        "Another generation is already in progress. Wait and retry."
      );
    });

    test("returns message for unsupported_locale error code", () => {
      expect(bridgeErrorMessage("unsupported_locale")).toBe(
        "The current language or locale is not supported by the on-device model."
      );
    });

    test("returns message for decoding_failure error code", () => {
      expect(bridgeErrorMessage("decoding_failure")).toBe(
        "Failed to decode model output. Try simplifying the request."
      );
    });

    test("returns message for unsupported_guide error code", () => {
      expect(bridgeErrorMessage("unsupported_guide")).toBe(
        "The generation guide/schema is not supported."
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

    test("BridgeContextSizeOutput shape", () => {
      const output: BridgeContextSizeOutput = { context_size: 4096 };
      expect(output.context_size).toBe(4096);
    });

    test("BridgeTokenCountOutput shape", () => {
      const output: BridgeTokenCountOutput = { token_count: 42 };
      expect(output.token_count).toBe(42);
    });
  });
});
