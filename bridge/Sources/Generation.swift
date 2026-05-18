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

        // Apple TN3193: Budget tokens and truncate before sending to the model
        let prepared = await ContextManager.prepare(
            prompt: input.prompt,
            instructions: instructions
        )

        let response = try await session.respond(to: prepared.prompt)

        return BridgeOutput(
            content: response.content,
            structured: nil,
            promptTokens: prepared.promptTokens,
            completionTokens: 0,
            finishReason: "stop",
            truncated: prepared.truncated,
            contextSize: prepared.contextSize
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

        // Apple TN3193: Budget tokens and truncate before sending to the model
        let prepared = await ContextManager.prepare(
            prompt: input.prompt,
            instructions: instructions
        )

        var fullContent = ""

        let responseStream = session.streamResponse(to: prepared.prompt)
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
            promptTokens: prepared.promptTokens,
            completionTokens: 0,
            finishReason: "stop",
            truncated: prepared.truncated,
            contextSize: prepared.contextSize
        )
        writeJSON(done)
    }
}
