import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum Benchmark {

    private static let fixedPrompt = "Explain what a compiler does in three sentences."

    static func run() async -> BenchmarkOutput {
        let availability = SystemLanguageModel.default.availability
        guard case .available = availability else {
            return BenchmarkOutput(
                available: false,
                tokensPerSecond: 0,
                latencyMs: 0,
                promptTokens: 0,
                completionTokens: 0
            )
        }

        let session = LanguageModelSession()
        let startTime = DispatchTime.now()

        do {
            let response = try await session.respond(to: fixedPrompt)
            let endTime = DispatchTime.now()

            let elapsedNs = endTime.uptimeNanoseconds - startTime.uptimeNanoseconds
            let elapsedMs = Int(elapsedNs / 1_000_000)

            // Rough token estimate: ~4 chars per token
            let estimatedTokens = response.content.count / 4
            let tokensPerSecond = elapsedMs > 0
                ? Double(estimatedTokens) / (Double(elapsedMs) / 1000.0)
                : 0

            return BenchmarkOutput(
                available: true,
                tokensPerSecond: (tokensPerSecond * 10).rounded() / 10,
                latencyMs: elapsedMs,
                promptTokens: fixedPrompt.count / 4,
                completionTokens: estimatedTokens
            )
        } catch {
            return BenchmarkOutput(
                available: false,
                tokensPerSecond: 0,
                latencyMs: 0,
                promptTokens: 0,
                completionTokens: 0
            )
        }
    }
}

@available(macOS 26.0, *)
enum AvailabilityCheck {

    static func check() -> AvailabilityOutput {
        let availability = SystemLanguageModel.default.availability
        switch availability {
        case .available:
            return AvailabilityOutput(available: true, reason: nil)
        case .unavailable(let reason):
            let reasonString: String
            switch reason {
            case .appleIntelligenceNotEnabled:
                reasonString = "apple_intelligence_not_enabled"
            case .deviceNotEligible:
                reasonString = "device_not_eligible"
            default:
                reasonString = "unknown"
            }
            return AvailabilityOutput(available: false, reason: reasonString)
        default:
            return AvailabilityOutput(available: false, reason: "unknown")
        }
    }
}
