---
name: applepi
description: On-device Apple Intelligence as a Pi tool and model provider
---

# applepi

Exposes Apple's on-device AI model to Pi via three tools and a custom model provider.

## Tools

- **applepi_query** — General-purpose text generation (summarization, classification, naming, brainstorming)
- **applepi_generate** — Structured JSON output guided by a JSON Schema
- **applepi_benchmark** — Performance metrics for the on-device model

## Model Provider

Use `/model apple-intelligence` to select the on-device model for the current session.

## Requirements

- macOS 26+ (Tahoe)
- Apple Silicon (M1+)
- Apple Intelligence enabled in System Settings
- Swift toolchain (Xcode or Command Line Tools)
