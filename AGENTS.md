# applepi — Agent Instructions

This is a Pi package that exposes Apple's on-device FoundationModels as Pi tools and a custom model provider.

## Architecture

- `bridge/` — Swift CLI that wraps LanguageModelSession. JSON stdin → JSON stdout.
  - `ContextManager.swift` — Token budgeting and prompt truncation using Apple's real `tokenCount(for:)` and `contextSize` APIs. This is the single enforcement point for the 4096-token context window (Apple TN3193).
  - `Generation.swift` — Non-streaming and streaming generation, wired through ContextManager.
  - `Schema.swift` — Structured JSON generation with schema-in-prompt approach.
  - `Models.swift` — All Codable input/output structs shared between bridge commands.
  - `main.swift` — CLI entry point. Commands: default (generate), `--check`, `--benchmark`, `--context-size`, `--token-count`.
- `extensions/applepi/` — TypeScript Pi extension. Registers tools + provider, manages bridge lifecycle.
  - `bridge.ts` — Spawns and communicates with the Swift bridge binary.
  - `tools.ts` — Pi tool definitions (`applepi_query`, `applepi_generate`, `applepi_benchmark`).
  - `provider.ts` — Pi model provider (uses minimal system prompt, not Pi's full one).
  - `context.ts` — TypeScript-side heuristic token estimates. The real truncation happens in Swift.
  - `types.ts` — Shared TypeScript interfaces matching bridge JSON contracts.

## Key Design Decisions

- **Truncation happens in Swift, not TypeScript.** The Swift bridge has access to Apple's real `tokenCount(for:)` and `contextSize` APIs. TypeScript passes prompts through unchanged and reads the bridge's `truncated` flag from the response.
- **Minimal system prompt for provider mode.** Pi's full system prompt (tool defs, project context, skills) easily exceeds 4096 tokens. The provider replaces it with a ~40-token prompt.
- **Each call is a fresh LanguageModelSession.** Apple recommends treating the model as a function/co-processor, not a long-lived chatbot.

## Development

- `pnpm install` — install deps
- `pnpm test` — run vitest (must pass before any PR)
- `pnpm run bridge:build` — compile Swift bridge
- Bridge binary lands at `bridge/.build/release/applepi-bridge`

## Conventions

- TDD: write failing test first, then implement
- All TypeScript in `extensions/applepi/`
- Types shared via `types.ts`
- Mock the bridge binary in tests — don't depend on Swift compiler in CI
- 100% branch coverage target

## PR and Release Workflow

- **No direct pushes to `main`.** Branch protection is enforced for all users including admins.
- **All changes go through a PR.**
- **Before opening any PR, confirm whether the change should bump semver and trigger a release:**
  - **Patch** (0.x.Y): bug fixes, docs, refactors with no API changes
  - **Minor** (0.X.0): new features, new tools, new bridge commands, new exports
  - **Major** (X.0.0): breaking changes to tool interfaces, bridge JSON contracts, or provider behavior
  - If a version bump is needed, include it in the PR (edit `version` in `package.json`).
  - On merge to `main`, the `tag-release.yml` workflow auto-creates a git tag, which triggers `publish.yml` to publish to npm.
- **If no version bump is needed** (e.g., docs-only, test-only changes), say so explicitly in the PR description.
