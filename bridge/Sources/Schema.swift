import Foundation
import FoundationModels

@available(macOS 26.0, *)
enum SchemaGeneration {

    /// Generates structured JSON output by injecting the schema into the system prompt
    /// This is Tier 1: prompt-based JSON mode
    static func generate(input: BridgeInput) async throws -> BridgeOutput {
        guard let schema = input.schema else {
            throw BridgeError.usage("schema field is required for structured generation")
        }

        // Serialize the schema to include in the system prompt
        let schemaData = try jsonEncoder.encode(schema)
        let schemaString = String(data: schemaData, encoding: .utf8) ?? "{}"

        let systemPrompt = """
        \(input.systemPrompt ?? "You are a helpful assistant.")

        IMPORTANT: You must respond with ONLY valid JSON matching this schema. No markdown, no explanation, no code fences. Just raw JSON.

        JSON Schema:
        \(schemaString)
        """

        let instructions = Instructions(systemPrompt)
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: input.prompt)

        let content = response.content.trimmingCharacters(in: .whitespacesAndNewlines)

        // Try to parse as JSON to populate the structured field
        var structured: [String: AnyCodable]? = nil
        if let data = content.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            structured = dict.mapValues { AnyCodable($0) }
        }

        return BridgeOutput(
            content: content,
            structured: structured,
            promptTokens: 0,
            completionTokens: 0,
            finishReason: "stop"
        )
    }
}
