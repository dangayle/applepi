import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum Generation {

    /// Performs a non-streaming generation request
    static func respond(input: BridgeInput) async throws -> BridgeOutput {
        let instructions: Instructions? = input.systemPrompt.map { Instructions($0) }
        let session: LanguageModelSession
        if let instructions {
            session = LanguageModelSession(instructions: instructions)
        } else {
            session = LanguageModelSession()
        }

        let prompt = input.prompt
        let response = try await session.respond(to: prompt)

        return BridgeOutput(
            content: response.content,
            structured: nil,
            promptTokens: 0,
            completionTokens: 0,
            finishReason: "stop"
        )
    }

    /// Performs a streaming generation request, writing NDJSON to stdout
    static func stream(input: BridgeInput) async throws {
        let instructions: Instructions? = input.systemPrompt.map { Instructions($0) }
        let session: LanguageModelSession
        if let instructions {
            session = LanguageModelSession(instructions: instructions)
        } else {
            session = LanguageModelSession()
        }

        let prompt = input.prompt
        var fullContent = ""

        let responseStream = session.streamResponse(to: prompt)
        for try await partial in responseStream {
            let newContent = partial.content
            if newContent.count > fullContent.count {
                let delta = String(newContent.dropFirst(fullContent.count))
                let event = StreamDelta(type: "delta", content: delta)
                writeJSON(event)
                fullContent = newContent
            }
        }

        let done = StreamDone(
            type: "done",
            content: fullContent,
            promptTokens: 0,
            completionTokens: 0,
            finishReason: "stop"
        )
        writeJSON(done)
    }
}
