# applepi — Agent Instructions

This is a Pi package that exposes Apple's on-device FoundationModels as Pi tools and a custom model provider.

## Architecture

- `bridge/` — Swift CLI that wraps LanguageModelSession. JSON stdin → JSON stdout.
- `extensions/applepi/` — TypeScript Pi extension. Registers tools + provider, manages bridge lifecycle.

## Development

- `pnpm install` — install deps
- `pnpm test` — run vitest
- `pnpm run bridge:build` — compile Swift bridge
- Bridge binary lands at `bridge/.build/release/applepi-bridge`

## Conventions

- TDD: write failing test first, then implement
- All TypeScript in `extensions/applepi/`
- Types shared via `types.ts`
- Mock the bridge binary in tests — don't depend on Swift compiler in CI
- 100% branch coverage target
