import Foundation
import FoundationModels

// MARK: - Exit codes

func exitWithCode(_ code: Int32, error: String? = nil, message: String? = nil) -> Never {
    if let error, let message {
        writeError(error, message)
    }
    exit(code)
}

// MARK: - stdin reader

func readStdin() -> String? {
    var input = ""
    while let line = readLine(strippingNewline: false) {
        input += line
    }
    return input.isEmpty ? nil : input
}

// MARK: - Main

@available(macOS 26.0, *)
func main() async {
    let args = CommandLine.arguments

    // --check: availability probe
    if args.contains("--check") {
        let result = AvailabilityCheck.check()
        writeJSON(result)
        exit(0)
    }

    // --benchmark: performance probe
    if args.contains("--benchmark") {
        let result = await Benchmark.run()
        writeJSON(result)
        exit(0)
    }

    // --context-size: report the model's context window size (Apple TN3193)
    if args.contains("--context-size") {
        let model = SystemLanguageModel.default
        // contextSize is Int? — use 4096 as fallback for older OS versions
        let size = model.contextSize ?? 4096
        writeJSON(ContextSizeOutput(contextSize: size))
        exit(0)
    }

    // --token-count: count tokens for text provided via stdin (Apple TN3193)
    if args.contains("--token-count") {
        guard let text = readStdin() else {
            exitWithCode(2, error: "usage_error", message: "No text provided on stdin for token counting")
        }
        let model = SystemLanguageModel.default
        // tokenCount(for:) takes Instructions — wrap the text
        let instructions = Instructions(text)
        do {
            let count = try await model.tokenCount(for: instructions)
            writeJSON(TokenCountOutput(tokenCount: count))
            exit(0)
        } catch {
            exitWithCode(1, error: "runtime_error", message: "Failed to count tokens: \(error.localizedDescription)")
        }
    }

    // Default: generation mode — read input from stdin
    guard let stdinString = readStdin(),
          let stdinData = stdinString.data(using: .utf8) else {
        exitWithCode(2, error: "usage_error", message: "No input provided on stdin")
    }

    let input: BridgeInput
    do {
        input = try jsonDecoder.decode(BridgeInput.self, from: stdinData)
    } catch {
        exitWithCode(2, error: "usage_error", message: "Invalid JSON input: \(error.localizedDescription)")
    }

    do {
        if input.schema != nil {
            // Structured generation
            let result = try await SchemaGeneration.generate(input: input)
            writeJSON(result)
        } else if input.stream == true {
            // Streaming generation
            try await Generation.stream(input: input)
        } else {
            // Non-streaming generation
            let result = try await Generation.respond(input: input)
            writeJSON(result)
        }
    } catch let error as LanguageModelSession.GenerationError {
        switch error {
        case .guardrailViolation:
            exitWithCode(3, error: "guardrail_blocked",
                        message: "The request was blocked by Apple's safety guardrails.")
        case .exceededContextWindowSize:
            exitWithCode(4, error: "context_overflow",
                        message: "Input too long for the context window. Shorten the prompt.")
        case .assetsUnavailable:
            exitWithCode(5, error: "model_unavailable",
                        message: "The on-device model assets are not available.")
        case .rateLimited:
            exitWithCode(1, error: "rate_limited",
                        message: "On-device model is rate limited. Wait a moment and try again.")
        case .refusal:
            exitWithCode(3, error: "guardrail_blocked",
                        message: "The model refused this request.")
        case .concurrentRequests:
            exitWithCode(1, error: "concurrent_requests",
                        message: "Another generation is already in progress. Wait and retry.")
        case .unsupportedLanguageOrLocale:
            exitWithCode(1, error: "unsupported_locale",
                        message: "The current language or locale is not supported by the on-device model.")
        case .decodingFailure:
            exitWithCode(1, error: "decoding_failure",
                        message: "Failed to decode model output.")
        case .unsupportedGuide:
            exitWithCode(1, error: "unsupported_guide",
                        message: "The generation guide/schema is not supported.")
        @unknown default:
            exitWithCode(1, error: "unknown",
                        message: "Generation error: \(error.localizedDescription)")
        }
    } catch {
        exitWithCode(1, error: "unknown", message: "Unexpected error: \(error.localizedDescription)")
    }
}

// Entry point — check platform availability
if #available(macOS 26.0, *) {
    await main()
} else {
    writeError("model_unavailable", "applepi requires macOS 26 (Tahoe) or later")
    exit(5)
}
