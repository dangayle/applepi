import Foundation

/// Input JSON from TypeScript layer via stdin
struct BridgeInput: Codable {
    let prompt: String
    var systemPrompt: String?
    var stream: Bool?
    var permissive: Bool?
    var temperature: Double?
    var maxTokens: Int?
    var seed: Int?
    var schema: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case prompt
        case systemPrompt = "system_prompt"
        case stream
        case permissive
        case temperature
        case maxTokens = "max_tokens"
        case seed
        case schema
    }
}

/// Output JSON for non-streaming responses
struct BridgeOutput: Codable {
    let content: String
    var structured: [String: AnyCodable]?
    let promptTokens: Int
    let completionTokens: Int
    let finishReason: String

    enum CodingKeys: String, CodingKey {
        case content
        case structured
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case finishReason = "finish_reason"
    }
}

/// Streaming delta event
struct StreamDelta: Codable {
    let type: String
    let content: String
}

/// Streaming done event
struct StreamDone: Codable {
    let type: String
    let content: String
    let promptTokens: Int
    let completionTokens: Int
    let finishReason: String

    enum CodingKeys: String, CodingKey {
        case type, content
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case finishReason = "finish_reason"
    }
}

/// Error output (written to stderr)
struct BridgeErrorOutput: Codable {
    let error: String
    let message: String
}

/// Benchmark output
struct BenchmarkOutput: Codable {
    let available: Bool
    let tokensPerSecond: Double
    let latencyMs: Int
    let promptTokens: Int
    let completionTokens: Int

    enum CodingKeys: String, CodingKey {
        case available
        case tokensPerSecond = "tokens_per_second"
        case latencyMs = "latency_ms"
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
    }
}

/// Availability check output
struct AvailabilityOutput: Codable {
    let available: Bool
    let reason: String?
}

// MARK: - AnyCodable helper for arbitrary JSON

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON type")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, .init(codingPath: encoder.codingPath, debugDescription: "Unsupported type"))
        }
    }
}

// MARK: - Error type

enum BridgeError: Error {
    case usage(String)
    case guardrailBlocked(String)
    case contextOverflow(String)
    case modelUnavailable(String)
    case runtime(String)
}

// MARK: - JSON helpers

let jsonEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
}()

let jsonDecoder = JSONDecoder()

func writeJSON<T: Encodable>(_ value: T, to fileHandle: FileHandle = .standardOutput) {
    guard let data = try? jsonEncoder.encode(value) else { return }
    fileHandle.write(data)
    fileHandle.write("\n".data(using: .utf8)!)
}

func writeError(_ code: String, _ message: String) {
    let error = BridgeErrorOutput(error: code, message: message)
    guard let data = try? jsonEncoder.encode(error) else { return }
    FileHandle.standardError.write(data)
    FileHandle.standardError.write("\n".data(using: .utf8)!)
}
