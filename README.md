# 🥧 applepi

> On-device Apple Intelligence as a Pi tool and model provider.
> Free, private, zero API keys. macOS 26+, Apple Silicon.

## Install

```bash
# From npm
pi install npm:@dangayle/applepi

# From GitHub
pi install git:github.com/dangayle/applepi
```

## What You Get

### Three Tools

| Tool | Purpose |
|------|---------|
| `applepi_query` | General-purpose on-device text generation |
| `applepi_generate` | Structured JSON output guided by a schema |
| `applepi_benchmark` | Performance metrics for the on-device model |

### Model Provider

Use Apple Intelligence like any other model in Pi:

```
/model apple-intelligence
```

Route lightweight tasks to the free on-device model, heavy tasks to Claude.

### Slash Command

Quick one-shot query with no context — doesn't enter the conversation:

```
/apple What is the capital of France?
```

## Requirements

- macOS 26+ (Tahoe)
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
- Swift toolchain (Xcode or Command Line Tools)

## How It Works

`applepi` has two components:

1. **Swift Bridge** — A minimal CLI wrapping Apple's `LanguageModelSession`. JSON in via stdin, JSON out via stdout. Built automatically on first use.

2. **Pi Extension** — TypeScript that registers tools, model provider, and the `/apple` command with Pi. Manages the Swift binary lifecycle, error handling, streaming, and output formatting.

No HTTP servers, no API keys, no code signing. The on-device model runs entirely on your Mac's Neural Engine.

## Development

```bash
git clone https://github.com/dangayle/applepi
cd applepi
pnpm install
pnpm test              # Run TypeScript tests
pnpm run bridge:build  # Compile Swift bridge
```

## Limitations

- **4096-token context window** (input + output combined)
- **No vision/image support**
- **Slower than cloud models** (a few seconds per response)
- **Apple's safety guardrails** may refuse some prompts — use `permissive: true` to reduce false positives

## License

MIT
