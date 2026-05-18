/**
 * Context window utilities for Apple Intelligence's 4096-token limit.
 *
 * NOTE: The primary token counting and truncation happens in the Swift bridge
 * using Apple's real `tokenCount(for:)` and `contextSize` APIs (TN3193).
 * This module provides:
 * - Heuristic token estimation for pre-flight checks in TypeScript
 * - Constants for the default context size and response reserve
 * - A `buildPromptWithBudget` helper for callers that need quick estimates
 *   without round-tripping to the bridge (e.g., tool descriptions, UI hints)
 *
 * @see https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window
 */

/** Default context window size for Apple's on-device model */
export const DEFAULT_CONTEXT_SIZE = 4096;

/** Tokens reserved for the model's response. Must be enough for a useful answer. */
export const RESPONSE_RESERVE = 1024;

/**
 * Rough token estimate: ~4 characters per token.
 * This is a heuristic — the Swift bridge uses Apple's real tokenCount(for:) API.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncates text to fit within a token budget using a head+tail strategy.
 * Preserves the beginning and end of the text (where the most important
 * context and the most recent information typically live).
 *
 * NOTE: The Swift bridge does this with real token counts. This function
 * is a TypeScript-side fallback using heuristic estimates.
 */
export function truncateText(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;

  // Convert token budget to approximate character budget
  const maxChars = maxTokens * 4;
  const marker = "\n\n[...truncated to fit 4096-token context window...]\n\n";

  // Split budget: 60% head, 40% tail (head bias — instructions tend to be at the start)
  const markerChars = marker.length;
  const available = maxChars - markerChars;
  const headChars = Math.floor(available * 0.6);
  const tailChars = available - headChars;

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);

  return head + marker + tail;
}

/** Budget info returned by buildPromptWithBudget */
export interface BudgetInfo {
  contextSize: number;
  systemTokens: number;
  promptTokens: number;
  availableForResponse: number;
}

/** Options for buildPromptWithBudget */
export interface BuildPromptOptions {
  systemPrompt: string;
  prompt: string;
  contextSize?: number;
}

/** Result from buildPromptWithBudget */
export interface BuildPromptResult {
  systemPrompt: string;
  prompt: string;
  truncated: boolean;
  budgetInfo: BudgetInfo;
}

/**
 * Builds a prompt that fits within the context window budget using heuristic estimates.
 *
 * NOTE: The Swift bridge handles the real truncation with exact token counts.
 * This function is useful for:
 * - Pre-flight checks before calling the bridge
 * - UI hints about token usage
 * - Testing without the bridge binary
 */
export function buildPromptWithBudget(options: BuildPromptOptions): BuildPromptResult {
  const contextSize = options.contextSize ?? DEFAULT_CONTEXT_SIZE;
  const systemTokens = estimateTokens(options.systemPrompt);

  // Available for prompt = total - system - response reserve
  const availableForPrompt = contextSize - systemTokens - RESPONSE_RESERVE;

  const promptTokens = estimateTokens(options.prompt);
  const truncated = promptTokens > availableForPrompt;

  const finalPrompt = truncated
    ? truncateText(options.prompt, availableForPrompt)
    : options.prompt;

  const finalPromptTokens = estimateTokens(finalPrompt);

  return {
    systemPrompt: options.systemPrompt,
    prompt: finalPrompt,
    truncated,
    budgetInfo: {
      contextSize,
      systemTokens,
      promptTokens: finalPromptTokens,
      availableForResponse: contextSize - systemTokens - finalPromptTokens,
    },
  };
}
