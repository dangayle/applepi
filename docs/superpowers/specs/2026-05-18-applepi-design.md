# applepi — Design Spec

> On-device Apple Intelligence as a Pi tool and model provider.
> Free, private, zero API keys. macOS 26+, Apple Silicon.

## Overview

`applepi` is a Pi package that exposes Apple's on-device FoundationModels framework to the Pi coding agent. It consists of two components:

1. **`applepi-bridge`** — A minimal Swift executable (~50-80 lines) that serves as a thin wrapper around `LanguageModelSession`. It reads input via stdin/CLI args, calls the on-device model, and writes output to stdout. It has no opinions about formatting, UX, or integration — it's a dumb pipe between the Apple model and the TypeScript layer.

2. **`applepi` Pi extension** (TypeScript) — The real brain. Registers tools and a custom model provider with Pi, manages the Swift binary lifecycle (build-on-first-use), handles errors, streaming, and output formatting.

## Requirements

- macOS 26+ (Tahoe)
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
- Swift toolchain (Xcode Command Line Tools or Xcode — needed for build-on-first-use)
- Pi coding agent installed

No paid Apple Developer account, no code signing certificates, no entitlements required.

---

## Component 1: Swift Bridge (`applepi-bridge`)

### Purpose

The thinnest possible wrapper around Apple's FoundationModels SDK. Exists only because the SDK is Swift-only. All logic beyond "call the model" lives in TypeScript.

### Interface

```
applepi-bridge [options]
```

**Input:** Prompt comes via stdin (for long prompts) or as a positional argument (for short ones). A JSON object is expected on stdin when structured options are needed:

```json
{
  "prompt": "What is the capital of France?",
  "system_prompt": "Answer in one word.",
  "stream": false,
  "permissive": false,
  "temperature": null,
  "max_tokens": null,
  "seed": null
}
```

**Output:** JSON to stdout:

```json
{
  "content": "Paris",
  "prompt_tokens": 12,
  "completion_tokens": 3,
  "finish_reason": "stop"
}
```

When `stream: true`, output is newline-delimited JSON (NDJSON):

```
{"type":"delta","content":"Par"}
{"type":"delta","content":"is"}
{"type":"done","content":"Paris","prompt_tokens":12,"completion_tokens":3,"finish_reason":"stop"}
```

**Structured generation mode:** When a `schema` field is present in the input JSON, the bridge injects the schema into the system prompt and instructs the model to produce valid JSON (Tier 1). For schemas matching pre-built templates, the bridge uses true `@Generable` constrained generation (Tier 2, future). Example:

```json
{
  "prompt": "Classify this error: connection timeout after 30s",
  "schema": {
    "type": "object",
    "properties": {
      "severity": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
      "category": { "type": "string" },
      "actionable": { "type": "boolean" }
    },
    "required": ["severity", "category", "actionable"]
  }
}
```

Output:

```json
{
  "content": "{\"severity\":\"high\",\"category\":\"timeout\",\"actionable\":true}",
  "structured": { "severity": "high", "category": "timeout", "actionable": true },
  "prompt_tokens": 18,
  "completion_tokens": 12,
  "finish_reason": "stop"
}
```

**Benchmark mode:** `applepi-bridge --benchmark` runs a fixed prompt and reports performance metrics:

```json
{
  "available": true,
  "tokens_per_second": 42.5,
  "latency_ms": 1850,
  "prompt_tokens": 8,
  "completion_tokens": 78
}
```

**Availability check:** `applepi-bridge --check` reports model availability without generating:

```json
{
  "available": true,
  "reason": null
}
```

Or when unavailable:

```json
{
  "available": false,
  "reason": "apple_intelligence_not_enabled"
}
```

### Error output

Errors go to stderr as JSON:

```json
{
  "error": "guardrail_blocked",
  "message": "The request was blocked by Apple's safety guardrails."
}
```

Error codes: `guardrail_blocked`, `context_overflow`, `model_unavailable`, `device_not_eligible`, `unknown`.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error |
| 2 | Usage error (bad args) |
| 3 | Guardrail blocked |
| 4 | Context overflow |
| 5 | Model unavailable |

### Build

The bridge is a Swift Package Manager project. Directory structure:

```
bridge/
  Package.swift
  Sources/
    main.swift        # Entry point, stdin parsing, dispatch
    Generation.swift  # LanguageModelSession calls (prompt, stream, structured)
    Schema.swift      # JSON Schema → @Generable mapping
    Benchmark.swift   # Fixed prompt benchmark
    Models.swift      # Input/output JSON types
```

Build command: `swift build -c release`

Binary output: `bridge/.build/release/applepi-bridge`

---

## Component 2: Pi Extension (TypeScript)

### Build-on-first-use

On first tool call, the extension:

1. Checks if the compiled binary exists at `~/.pi/agent/extensions/applepi/bridge/applepi-bridge`
2. If missing, runs `swift build -c release` in the bridge source directory
3. Copies the binary to the expected location
4. Caches the binary — subsequent calls skip the build

If `swift` is not found, the extension shows a clear error:

> "applepi requires Swift to compile the Apple Intelligence bridge. Install Xcode Command Line Tools: `xcode-select --install`"

If the OS/hardware doesn't support Apple Intelligence, the extension shows:

> "applepi requires macOS 26+ on Apple Silicon with Apple Intelligence enabled."

### Tool: `applepi_query`

General-purpose on-device text generation.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | The prompt to send to the on-device model |
| `system_prompt` | string | no | — | System prompt for context/persona |
| `stream` | boolean | no | false | Stream response token-by-token |
| `permissive` | boolean | no | false | Use permissive guardrails (reduces false positives) |
| `temperature` | number | no | — | Sampling temperature |
| `max_tokens` | number | no | — | Maximum response tokens |

**Returns:** Model response text + token usage metadata.

**Use cases:** Summarization, classification, naming, quick factual lookups, brainstorming — anything where a frontier model is overkill and you don't want to burn API credits.

**Timeout:** 30 seconds default (on-device model is slower than cloud models).

### Tool: `applepi_generate`

Structured output via guided generation. The model is constrained to produce valid JSON matching the provided schema.

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | string | yes | — | What to generate |
| `schema` | object | yes | — | JSON Schema for the output shape |
| `system_prompt` | string | no | — | System prompt for context |
| `permissive` | boolean | no | false | Use permissive guardrails |

**Returns:** Validated JSON matching the schema + token usage metadata.

**Schema support:**
- `type`: string, number, integer, boolean, object, array
- `enum`: constrained string values
- `minimum`/`maximum`: numeric ranges
- `pattern`: regex constraints
- `minItems`/`maxItems`: array length constraints
- `required`: required properties
- Nested objects

**Implementation note — `@Generable` is compile-time only:**

Apple's `@Generable` macro generates type constraints at compile time. You cannot dynamically create `@Generable` types from an arbitrary JSON schema at runtime. Therefore, structured generation uses a two-tier approach:

1. **Tier 1 (v1): Prompt-based JSON mode.** The bridge injects the JSON schema into the system prompt, instructing the model to produce valid JSON matching it. The TypeScript layer validates the response against the schema before returning. This is the same approach used by OpenAI's JSON mode and works well in practice.

2. **Tier 2 (future): Pre-built `@Generable` templates.** For high-value, frequently-used patterns (classification, entity extraction, sentiment analysis), ship pre-compiled `@Generable` types in the bridge that provide true constrained generation. The TypeScript layer selects the matching template when the incoming schema fits a known shape, falls back to Tier 1 otherwise.

**Example:**

```typescript
applepi_generate({
  prompt: "Classify this error: connection timeout after 30s to payments API",
  schema: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      category: { type: "string" },
      actionable: { type: "boolean" },
      suggested_action: { type: "string" }
    },
    required: ["severity", "category", "actionable"]
  }
})
// → { severity: "high", category: "timeout", actionable: true, suggested_action: "Check payments API health and retry with backoff" }
```

### Tool: `applepi_benchmark`

Performance probe for the on-device model.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | | | Runs a fixed benchmark and returns stats |

**Returns:**

```json
{
  "available": true,
  "tokens_per_second": 42.5,
  "latency_ms": 1850,
  "prompt_tokens": 8,
  "completion_tokens": 78
}
```

### Custom Provider: `apple-intelligence`

Registers Apple Intelligence as a Pi model provider so it can be used like any other model (Claude, GPT, etc.).

**Model registration:**
- Name: `apple-intelligence`
- Context window: 4096 tokens
- Capabilities: text generation, streaming
- No vision, no embeddings

**Provider implementation:**

The provider implements Pi's model provider interface:
- `chat(messages, options)` — Serializes the Pi message array into a prompt string (or uses the last user message), pipes to the Swift bridge, returns the response.
- Streaming support via the bridge's NDJSON output.
- Token usage reporting from the bridge's real token counts.

**Usage:**
- Set as default model: configure in Pi settings
- Use via profiles: route lightweight tasks to `apple-intelligence`, heavy tasks to Claude
- Select per-session: `/model apple-intelligence`

**Limitations the provider must communicate to Pi:**
- 4096 token context window (input + output combined)
- No vision/image support
- No embeddings
- Slower than cloud models (few seconds per response)
- May refuse prompts due to Apple's safety guardrails

---

## Project Structure

```
applepi/
├── package.json              # Pi package manifest (pi-package keyword)
├── tsconfig.json
├── README.md
├── LICENSE                   # MIT
├── AGENTS.md
├── extensions/
│   └── applepi/
│       ├── index.ts          # Extension entry: registers tools + provider
│       ├── index.test.ts     # Unit tests (100% branch coverage)
│       ├── bridge.ts         # Swift bridge manager (build, spawn, communicate)
│       ├── bridge.test.ts    # Bridge manager tests
│       ├── provider.ts       # Custom model provider implementation
│       ├── provider.test.ts  # Provider tests
│       ├── tools.ts          # Tool definitions (query, generate, benchmark)
│       ├── tools.test.ts     # Tool tests
│       └── README.md         # Extension docs with frontmatter
├── bridge/
│   ├── Package.swift         # SwiftPM manifest
│   └── Sources/
│       ├── main.swift        # Entry point, stdin parsing, dispatch
│       ├── Generation.swift  # LanguageModelSession calls
│       ├── Schema.swift      # JSON Schema → @Generable mapping
│       ├── Benchmark.swift   # Performance benchmark
│       └── Models.swift      # Input/output JSON codable types
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-18-applepi-design.md  # This file
```

## Error Handling Strategy

All errors surface through Pi's standard tool error mechanism with clear, actionable messages:

| Error | User sees |
|-------|-----------|
| Swift not installed | "Install Xcode Command Line Tools: `xcode-select --install`" |
| Not macOS 26+ | "applepi requires macOS 26 (Tahoe) or later" |
| Not Apple Silicon | "applepi requires Apple Silicon (M1 or later)" |
| Apple Intelligence off | "Enable Apple Intelligence in System Settings → Apple Intelligence & Siri" |
| Guardrail blocked | "Apple's safety guardrails blocked this request. Try rephrasing or using `permissive: true`." |
| Context overflow | "Input too long for the 4096-token context window. Shorten the prompt." |
| Bridge build failed | "Failed to compile the Swift bridge. Check `swift --version` output." |
| Bridge timeout | "On-device model timed out (30s). The model may be loading — try again." |

## Testing Strategy

### TypeScript (vitest)

- **Unit tests** for each module: tools, provider, bridge manager
- **100% branch coverage** required (shop-pi-fy convention carried forward)
- Mock the bridge binary in tests — test the TypeScript logic, not the Swift compiler
- Test error paths: missing binary, build failure, bridge crashes, timeouts, all error codes

### Swift

- The bridge is simple enough that integration testing via the TypeScript tests (spawning the real binary) covers it
- If complexity grows, add Swift tests via `swift test`

### Smoke test

- Extension loads in Pi without crashing
- Bridge binary builds successfully on a macOS 26 machine

## Out of Scope for v1

- HTTP server / OpenAI-compatible API endpoint (Pi provider handles this natively)
- MCP tool support (Pi has its own MCP infrastructure)
- Interactive chat REPL (Pi is the chat interface)
- Multi-turn conversation management (Pi handles context)
- Vision / image input (not available on-device)
- Embeddings (not available on-device)
- Demo scripts (cmd, oneliner, etc.)
- npm publishing (Pi packages are GitHub repos)

## Future Considerations

- **Expanded context window**: If Apple increases beyond 4096 tokens, update the provider's reported context size
- **Tool calling through the bridge**: Let the on-device model call Pi tools — interesting but the small context window makes this impractical today
- **Model selection**: If Apple exposes multiple on-device models, let users choose
- **Caching**: Cache structured generation results for repeated schema+prompt combinations
- **Offline indicator**: Show in Pi's UI when the on-device model is available vs. not
