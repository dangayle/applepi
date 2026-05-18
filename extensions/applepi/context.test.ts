import { describe, test, expect } from "vitest";
import {
  truncateText,
  estimateTokens,
  buildPromptWithBudget,
  DEFAULT_CONTEXT_SIZE,
  RESPONSE_RESERVE,
} from "./context.js";

describe("estimateTokens", () => {
  test("estimates ~4 chars per token", () => {
    expect(estimateTokens("hello")).toBe(2); // 5 chars / 4 = 1.25, ceil = 2
  });

  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("handles longer text", () => {
    const text = "a".repeat(400);
    expect(estimateTokens(text)).toBe(100); // 400 / 4 = 100
  });
});

describe("truncateText", () => {
  test("returns text unchanged when under the token budget", () => {
    const text = "Short text";
    expect(truncateText(text, 100)).toBe(text);
  });

  test("truncates long text with head + tail strategy", () => {
    // Create text that's ~100 tokens (400 chars)
    const text = "A".repeat(200) + "B".repeat(200);
    // Budget of 20 tokens (80 chars) — should truncate
    const result = truncateText(text, 20);

    expect(result).toContain("A"); // has head
    expect(result).toContain("B"); // has tail
    expect(result).toContain("[...truncated"); // has marker
    expect(result.length).toBeLessThan(text.length);
  });

  test("preserves head and tail of original text", () => {
    const head = "HEAD_CONTENT_";
    const middle = "x".repeat(400);
    const tail = "_TAIL_CONTENT";
    const text = head + middle + tail;

    const result = truncateText(text, 30);
    expect(result.startsWith("HEAD_CONTENT")).toBe(true);
    expect(result.endsWith("_TAIL_CONTENT")).toBe(true);
  });

  test("returns text unchanged when exactly at budget", () => {
    const text = "a".repeat(80); // 80 chars = 20 tokens
    expect(truncateText(text, 20)).toBe(text);
  });
});

describe("buildPromptWithBudget", () => {
  test("returns prompt unchanged when everything fits", () => {
    const result = buildPromptWithBudget({
      systemPrompt: "Be helpful.",
      prompt: "What is 2+2?",
      contextSize: 4096,
    });

    expect(result.systemPrompt).toBe("Be helpful.");
    expect(result.prompt).toBe("What is 2+2?");
    expect(result.truncated).toBe(false);
  });

  test("truncates prompt when it would overflow context", () => {
    const longPrompt = "word ".repeat(5000); // ~5000 tokens
    const result = buildPromptWithBudget({
      systemPrompt: "Be helpful.",
      prompt: longPrompt,
      contextSize: 4096,
    });

    expect(result.truncated).toBe(true);
    expect(result.prompt.length).toBeLessThan(longPrompt.length);
    expect(result.prompt).toContain("[...truncated");
  });

  test("respects response reserve", () => {
    // System prompt ~3 tokens, fill prompt to near the limit
    const result = buildPromptWithBudget({
      systemPrompt: "Hi",
      prompt: "a".repeat(14000), // ~3500 tokens
      contextSize: 4096,
    });

    // Should truncate because we need RESPONSE_RESERVE tokens for the response
    expect(result.truncated).toBe(true);
    const totalEstimate =
      estimateTokens(result.systemPrompt) + estimateTokens(result.prompt);
    expect(totalEstimate).toBeLessThanOrEqual(4096 - RESPONSE_RESERVE);
  });

  test("uses DEFAULT_CONTEXT_SIZE when contextSize not provided", () => {
    const result = buildPromptWithBudget({
      systemPrompt: "Hi",
      prompt: "Hello",
    });

    expect(result.prompt).toBe("Hello");
    expect(result.truncated).toBe(false);
  });

  test("returns available token budget info", () => {
    const result = buildPromptWithBudget({
      systemPrompt: "Be brief.",
      prompt: "What is AI?",
      contextSize: 4096,
    });

    expect(result.budgetInfo).toBeDefined();
    expect(result.budgetInfo.contextSize).toBe(4096);
    expect(result.budgetInfo.systemTokens).toBeGreaterThan(0);
    expect(result.budgetInfo.promptTokens).toBeGreaterThan(0);
    expect(result.budgetInfo.availableForResponse).toBeGreaterThan(0);
  });
});

describe("constants", () => {
  test("DEFAULT_CONTEXT_SIZE is 4096", () => {
    expect(DEFAULT_CONTEXT_SIZE).toBe(4096);
  });

  test("RESPONSE_RESERVE is reasonable", () => {
    // Should be at least 256 tokens for a usable response
    expect(RESPONSE_RESERVE).toBeGreaterThanOrEqual(256);
    // But not more than half the context
    expect(RESPONSE_RESERVE).toBeLessThan(DEFAULT_CONTEXT_SIZE / 2);
  });
});
