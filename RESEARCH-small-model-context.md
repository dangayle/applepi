# Research: How Coding Agents Handle Small Local Models

> **Context:** Apple's on-device FoundationModels has a **fixed 4096-token context window** (all input + output combined). This document surveys how major coding agents avoid overwhelming small models, and what patterns applepi could adopt.

---

## TL;DR — The 5 Key Patterns

| Pattern | Who Uses It | Token Cost | Complexity |
|---|---|---|---|
| **1. Last-message-only dispatch** | applepi (current), Pi tools | ~200-500 tokens | Low |
| **2. Conversation compaction/summarization** | Claude Code, Codex CLI | ~300-800 tokens | Medium |
| **3. Repo map / architecture index** | Aider (Tree-sitter), Claude Code (CLAUDE.md) | ~500-1500 tokens | High |
| **4. Tool output truncation** | Codex CLI, all agents | Varies | Low-Medium |
| **5. Multi-session task splitting** | Apple's own recommendation | ~200 per session | Medium |

---

## 1. What applepi Does Today (Baseline)

The current `provider.ts` already makes smart choices for a 4096-token model:

```typescript
// provider.ts — current approach
const MINIMAL_SYSTEM_PROMPT = 
  "You are a helpful, concise assistant running on-device via Apple Intelligence. " +
  "You have a small context window, so keep responses focused and brief. " +
  "Answer directly without attempting to invoke functions or access external systems.";

// Only sends the LAST user message — ignores conversation history entirely
function extractPrompt(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { /* return just this message */ }
  }
}
```

**What's good:**
- Ignores Pi's massive system prompt (tool defs, project context, skills = easily 10k+ tokens)
- Replaces it with a tiny ~40-token system prompt
- Sends only the latest user message, avoiding history bloat

**What's missing:**
- Zero conversational memory — every request is stateless
- No context about what the user is working on
- No awareness of recently-edited files or project structure
- The tool descriptions in Pi hint at its capabilities, but the model itself is unaware

---

## 2. How Claude Code Handles Context

Claude Code manages a 200k context window, but its patterns are instructive because it treats context as a **scarce resource** even at that size:

### Auto-Compact (triggered at ~95% capacity)
1. Tracks total token usage across system prompt + conversation + tool results
2. When approaching the limit, generates a **structured summary** preserving:
   - Project goals and constraints
   - Key files and architecture
   - Decisions made and rationale
   - Open tasks (as checklist)
3. Replaces old messages with the summary + keeps last N turns verbatim

### CLAUDE.md — Persistent Project Context
- A small file always loaded into context with:
  - Project overview, tech stack, conventions
  - Key file paths and architecture
  - Non-negotiable constraints
- Acts as "durable memory" that survives compaction

### Layered Context Architecture
```
Layer 1: System instructions (static, cached)
Layer 2: CLAUDE.md project context (semi-static)  
Layer 3: Conversation summary (updated periodically)
Layer 4: Recent turns verbatim (rolling window)
Layer 5: Current tool results (volatile, largest)
```

**Applicable to applepi:** The layered model works, but everything must fit in ~3000 tokens (leaving ~1000 for the response). The summary/CLAUDE.md pattern could work if kept extremely compact.

---

## 3. How Codex CLI Handles Context

OpenAI's Codex CLI uses a similar architecture:

### Prompt Caching + Compaction
- **Prompt caching:** Shared prefixes (instructions, AGENTS.md) are cached so they don't recompute
- **Auto-compaction:** When token count exceeds threshold, older messages and tool outputs are replaced with a summary
- **Tool output handling:** Three layers:
  1. **Local pre-filtering** — CLI truncates huge outputs (head + tail) before sending to model
  2. **Model-side limit check** — triggers compaction if prompt too large  
  3. **Semantic summarization** — old tool outputs get summarized ("pytest showed 3 failures: A, B, C")

### Context-Gathering Sub-Agent Pattern
Codex uses a **dedicated sub-agent** whose only job is assembling context:
1. Sub-agent gathers relevant files, test results, summaries
2. Compresses and structures everything
3. Hands the compact package to the main coding agent

**Applicable to applepi:** The sub-agent pattern is powerful — use the **frontier model (Claude/GPT)** to prepare compressed context, then dispatch the focused task to the on-device model.

---

## 4. How Aider Handles Context (Most Relevant for Small Models)

Aider is the canonical example of optimizing for constrained context windows:

### Tree-sitter Repo Map
1. **Parse** every file in the repo with Tree-sitter → AST
2. **Extract** symbol definitions (classes, functions, methods) + signatures
3. **Build** a file dependency graph (which files import from which)
4. **Rank** files by graph centrality (PageRank-like)
5. **Render** a compact map fitting a token budget (default: 1000 tokens)

Example output:
```
src/main.py:
  class RepoMap:
    def __init__(self, map_tokens: int = 1000)
    def get_repo_map(self, index: TagIndex) -> str
  def main(argv: list[str]) -> None

src/utils.py:
  def parse_config(path: str) -> Config
  def validate_schema(data: dict) -> bool
```

### Git-Aware Context Selection
- Only includes files that are:
  - Explicitly mentioned by the user
  - In the current git diff / changed set
  - Related to failing tests
- Works with **diffs** rather than full files

### Token Budget Management
- `--map-tokens` flag (default 1000) controls how much of the repo map to include
- Greedily selects highest-ranked files until budget exhausted
- For each file, includes only signatures + key lines (not full function bodies)

**Applicable to applepi:** The repo map idea is excellent for a 4096-token model. A ~500-token repo map + ~200-token task description leaves ~3000 tokens for response. But generating the map itself should happen outside the on-device model.

---

## 5. Apple's Own Recommendations

Apple explicitly addresses the 4096-token limit in TN3193 and developer forums:

### New APIs (iOS 26.4+ / macOS)
```swift
let model = SystemLanguageModel()
let maxTokens = model.contextSize          // 4096
let count = model.tokenCount(for: prompt)  // pre-flight check
```

### Apple's Recommended Strategies
1. **Split large tasks into multiple sessions** — treat the model as a function, not a chatbot
2. **Ask for concise responses** — explicitly request bullet points, word limits
3. **Prompt trimming / summarization** — retain only recent/relevant turns
4. **Use structured formats** — JSON, IDs, references instead of raw text
5. **Treat context like constrained memory** — budget, plan, trim aggressively

### What Happens on Overflow
- Throws `LanguageModelSession.GenerationError.exceededContextWindowSize`
- **No auto-trimming** — you must handle it yourself
- Must start a new `LanguageModelSession` and re-seed

---

## 6. Prompt Compression Techniques

For squeezing maximum value out of 4096 tokens:

### Rolling Conversation Summary (Best for Chat)
```
[System prompt: ~40 tokens]
[Rolling summary of conversation: ~300-600 tokens]
[Last 1-2 turns verbatim: ~500-1000 tokens]  
[Current user message: ~200-500 tokens]
— leaves ~1500-2500 tokens for response
```

The summary gets updated by asking the model:
> "Update this summary with new facts from the latest exchange. Keep under 400 tokens."

### Selective Context (Best for RAG/Tool Results)
- Score context chunks by relevance to the current query (TF-IDF, BM25, or embeddings)
- Keep only top-K chunks
- Discard the rest

### Two-Stage Compression
1. **Frontier model compresses** the full conversation/context into a compact brief
2. **On-device model** receives only the compressed brief + current task

This is the most promising pattern for applepi — use Claude/GPT as the "context compiler."

---

## 7. Recommended Strategies for applepi

### Strategy A: "Context Compiler" (Recommended)
Use the frontier model to prepare a compressed context package before dispatching to the on-device model.

```
Pi (Claude) prepares:
┌─────────────────────────────────┐
│ Compressed context (~800 tokens)│
│ • Project: TypeScript API       │
│ • Current file: auth/login.ts   │
│ • Task: rename `handleAuth`     │
│ • Key types: User, Session      │
│ • Constraints: keep backward    │
│   compat with v2 API            │
└─────────────────────────────────┘
         ↓ dispatched to
┌─────────────────────────────────┐
│ Apple Intelligence (4096 tokens)│
│ System: ~40 tokens              │
│ Context: ~800 tokens            │
│ Prompt: ~200 tokens             │
│ Response budget: ~3000 tokens   │
└─────────────────────────────────┘
```

### Strategy B: "Structured Dispatch" 
Define task-specific prompt templates that are pre-optimized for the small window:

```typescript
const TEMPLATES = {
  summarize: {
    system: "Summarize the following text concisely.",
    // budget: ~3500 tokens for input text, ~500 for output
  },
  classify: {
    system: "Classify the input into one of: {categories}. Reply with just the category.",
    // budget: ~3800 tokens for input, ~50 for output
  },
  name: {
    system: "Suggest 5 concise names for the described concept. One per line.",
    // budget: ~3500 for description, ~200 for output
  },
  extract: {
    system: "Extract structured data from the text as JSON matching the schema.",
    // budget: varies, schema takes tokens too
  },
};
```

### Strategy C: "Session Chaining"
For multi-step tasks, chain multiple on-device sessions:

```
Session 1: Summarize file A → summary_A
Session 2: Summarize file B → summary_B  
Session 3: Given summary_A + summary_B, answer question
```

Each session gets a fresh 4096-token budget.

### Strategy D: "Token Bookkeeping" (Pre-flight)
Use Apple's `tokenCount(for:)` API to check before sending:

```swift
let budget = model.contextSize  // 4096
let systemTokens = model.tokenCount(for: systemPrompt)
let promptTokens = model.tokenCount(for: userPrompt)
let available = budget - systemTokens - promptTokens
// If available < 500, compress the prompt first
```

---

## 8. What applepi Should NOT Do

1. **Don't send Pi's full system prompt** — it's 10k+ tokens with tool definitions ✅ (already avoided)
2. **Don't send conversation history as-is** — even 3 turns can overflow ✅ (already avoided)
3. **Don't try to make it a "chat" model** — treat it as a focused function/co-processor
4. **Don't send full file contents** — send only relevant snippets or summaries
5. **Don't expect tool-use capability** — the model can't reliably do ReAct-style tool calling at this size
6. **Don't hard-code 4096** — use `contextSize` API when available for future-proofing

---

## 9. Implementation Priority for applepi

| Priority | Enhancement | Effort | Impact |
|---|---|---|---|
| **P0** | Token counting pre-flight (use `tokenCount` API in bridge) | Low | Prevents crashes |
| **P0** | Expose `contextSize` from bridge for dynamic budget | Low | Future-proofs |
| **P1** | Task-specific prompt templates (summarize, classify, name, extract) | Medium | Better UX |
| **P1** | Input truncation with head+tail strategy | Low | Graceful degradation |
| **P2** | Context compiler pattern (frontier → on-device dispatch) | High | Unlocks complex tasks |
| **P2** | Session chaining for multi-step tasks | Medium | Broader capability |
| **P3** | Rolling conversation summary (if chat mode is desired) | Medium | Conversational UX |

---

## Sources

- [Claude Code context management](https://code.claude.com/docs/en/context-window)
- [Anthropic Cookbook: Automatic Context Compaction](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction)
- [OpenAI: Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [Aider: Tree-sitter Repo Map](https://aider.chat/2023/10/22/repomap.html)
- [Apple TN3193: Managing the on-device foundation model's context window](https://developer.apple.com/news/site-updates/?id=03312026a)
- [Apple Developer Forums: FoundationModel context length](https://developer.apple.com/forums/thread/806542)
- [LLMLingua: Prompt Compression](https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/)
- [Style-Compress: Task-Specific Compression](https://arxiv.org/html/2410.14042v1)
- [RunnerCode: Context Management for Coding Agents](https://runnercode.com/blog/context-management-for-coding-agents)
- [ZenML: Codex CLI Architecture](https://www.zenml.io/llmops-database/building-production-ready-ai-agents-openai-codex-cli-architecture-and-agent-loop-design)
