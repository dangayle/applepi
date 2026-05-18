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
  rate_limited:
    "On-device model is rate limited. Wait a moment and try again.",
  concurrent_requests:
    "Another generation is already in progress. Wait and retry.",
  unsupported_locale:
    "The current language or locale is not supported by the on-device model.",
  decoding_failure:
    "Failed to decode model output. Try simplifying the request.",
  unsupported_guide:
    "The generation guide/schema is not supported.",
  usage_error:
    "Invalid input to the Apple Intelligence bridge. Check the prompt and schema format.",
};

const DEFAULT_ERROR_MESSAGE =
  "An unknown error occurred in the Apple Intelligence bridge.";

/** Returns a user-facing error message for a bridge error code */
export function bridgeErrorMessage(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR_MESSAGE;
}
