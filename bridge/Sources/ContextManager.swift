import Foundation
import FoundationModels

/// Manages token budgeting and prompt truncation for Apple's on-device model.
///
/// Implements Apple TN3193: "Managing the on-device foundation model's context window"
/// - Uses the known 4096-token context window (Apple TN3193)
/// - Uses heuristic token estimation (~4 chars per token)
/// - Truncates prompts with head+tail strategy before they hit the model
/// - Falls back to catching `exceededContextWindowSize` errors at the call site
///
/// Note: The FoundationModels SDK does not expose `contextSize` or `tokenCount(for:)`
/// on SystemLanguageModel. Token budgeting uses heuristic estimation, with the
/// framework's own `exceededContextWindowSize` error as a safety net.
///
/// This is the single enforcement point — any caller of the bridge gets protection.
@available(macOS 26.0, *)
enum ContextManager {

    /// Known context window size for Apple's on-device model (Apple TN3193).
    static let contextWindowSize = 4096

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

    /// Prepares a prompt to fit within the context window.
    ///
    /// Steps (per Apple TN3193):
    /// 1. Estimate token cost of instructions (system prompt)
    /// 2. Compute available budget for the user prompt
    /// 3. Truncate the prompt with head+tail if it exceeds the budget
    /// 4. Return metadata about the budget for diagnostics
    static func prepare(
        prompt: String,
        instructions: Instructions?
    ) async -> PreparedPrompt {
        let ctxSize = contextWindowSize

        // Estimate instruction tokens (if any)
        var instructionTokens = 0
        if let instructions {
            instructionTokens = estimateTokens(String(describing: instructions))
        }

        // Budget for the prompt = total - instructions - response reserve
        let availableForPrompt = max(0, ctxSize - instructionTokens - responseReserve)

        // Estimate the actual prompt token count
        let promptTokens = estimateTokens(prompt)

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

        // Re-estimate after truncation
        let truncatedTokens = estimateTokens(truncated)

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

    /// Heuristic token estimation (~4 chars per token).
    /// This is the only estimation method available since the SDK does not expose
    /// a token counting API on SystemLanguageModel.
    static func estimateTokens(_ text: String) -> Int {
        guard !text.isEmpty else { return 0 }
        return (text.count + 3) / 4  // ceiling division
    }
}
