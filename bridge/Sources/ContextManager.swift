import Foundation
import FoundationModels

/// Manages token budgeting and prompt truncation using Apple's real token counting APIs.
///
/// Implements Apple TN3193: "Managing the on-device foundation model's context window"
/// - Uses `contextSize` for the real window size (not hardcoded)
/// - Uses `tokenCount(for:)` for exact token measurement
/// - Truncates prompts with head+tail strategy before they hit the model
///
/// This is the single enforcement point — any caller of the bridge gets protection.
@available(macOS 26.0, *)
enum ContextManager {

    /// Tokens reserved for the model's response. Must leave enough room for a useful answer.
    static let responseReserve = 1024

    /// Truncation marker inserted between head and tail when a prompt is truncated.
    private static let truncationMarker = "\n\n[...truncated to fit context window...]\n\n"

    /// Result of preparing a prompt for the context window.
    struct PreparedPrompt {
        let prompt: String
        let truncated: Bool
        let contextSize: Int
        let promptTokens: Int
        let instructionTokens: Int
        let availableForResponse: Int
    }

    /// Returns the model's context window size, with a safe fallback.
    static var contextSize: Int {
        SystemLanguageModel.default.contextSize ?? 4096
    }

    /// Prepares a prompt to fit within the context window.
    ///
    /// Steps (per Apple TN3193):
    /// 1. Measure token cost of instructions (system prompt)
    /// 2. Compute available budget for the user prompt
    /// 3. Truncate the prompt with head+tail if it exceeds the budget
    /// 4. Return metadata about the budget for diagnostics
    static func prepare(
        prompt: String,
        instructions: Instructions?
    ) async -> PreparedPrompt {
        let model = SystemLanguageModel.default
        let ctxSize = contextSize

        // Measure instruction tokens (if any)
        var instructionTokens = 0
        if let instructions {
            instructionTokens = (try? await model.tokenCount(for: instructions)) ?? 0
        }

        // Budget for the prompt = total - instructions - response reserve
        let availableForPrompt = max(0, ctxSize - instructionTokens - responseReserve)

        // Measure the actual prompt token count
        let promptInstructions = Instructions(prompt)
        let promptTokens = (try? await model.tokenCount(for: promptInstructions)) ?? estimateTokens(prompt)

        if promptTokens <= availableForPrompt {
            // Fits — no truncation needed
            return PreparedPrompt(
                prompt: prompt,
                truncated: false,
                contextSize: ctxSize,
                promptTokens: promptTokens,
                instructionTokens: instructionTokens,
                availableForResponse: ctxSize - instructionTokens - promptTokens
            )
        }

        // Truncate with head+tail strategy
        let truncated = truncate(text: prompt, toFitTokens: availableForPrompt)

        // Re-measure after truncation
        let truncatedInstructions = Instructions(truncated)
        let truncatedTokens = (try? await model.tokenCount(for: truncatedInstructions)) ?? estimateTokens(truncated)

        return PreparedPrompt(
            prompt: truncated,
            truncated: true,
            contextSize: ctxSize,
            promptTokens: truncatedTokens,
            instructionTokens: instructionTokens,
            availableForResponse: ctxSize - instructionTokens - truncatedTokens
        )
    }

    /// Truncates text using a head+tail strategy.
    /// Preserves the start (instructions/context) and end (most recent info) of the text.
    /// The middle is replaced with a truncation marker.
    static func truncate(text: String, toFitTokens maxTokens: Int) -> String {
        // Approximate: 1 token ≈ 4 characters (heuristic for character budget)
        let maxChars = maxTokens * 4
        let markerLen = truncationMarker.count
        let available = max(0, maxChars - markerLen)

        guard text.count > maxChars else { return text }

        // 60% head, 40% tail — instructions tend to be at the start
        let headChars = Int(Double(available) * 0.6)
        let tailChars = available - headChars

        let head = String(text.prefix(headChars))
        let tail = String(text.suffix(tailChars))

        return head + truncationMarker + tail
    }

    /// Fallback token estimation when the API call fails (~4 chars per token).
    private static func estimateTokens(_ text: String) -> Int {
        guard !text.isEmpty else { return 0 }
        return (text.count + 3) / 4  // ceiling division
    }
}
