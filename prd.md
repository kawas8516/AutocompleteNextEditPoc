# PRD: Continue (OpenRouter) — Autocomplete & NextEdit VS Code Extension

## Problem

This repository is a stripped-down fork of Continue Dev's `core` library — "Autocomplete and NextEdit only." It ships a complete, provider-agnostic autocomplete/NextEdit pipeline (context gathering, prompt templating, streaming, filtering, postprocessing) but, prior to this work, had **no installable VS Code extension**: no `activate()`, no `contributes` manifest, no way for a user to supply credentials, and no concrete LLM provider wired to OpenRouter.

Goal: ship a working VS Code extension where a user brings their own [OpenRouter](https://openrouter.ai) API key and picks any OpenRouter model, and gets the same autocomplete/NextEdit experience the underlying pipeline already provides — without rewriting that pipeline.

## In scope

- A loadable VS Code extension (`extension/`) that activates, registers inline-completion and NextEdit UI, and wires OpenRouter as the sole LLM backend.
- User-supplied OpenRouter API key, stored via `vscode.SecretStorage` (not plaintext settings), set via a command with eager validation.
- User-configurable OpenRouter model (free-text setting — OpenRouter's catalog is large and changes frequently, so no fixed enum).
- Reuse of the existing context/prompt/streaming/filtering/postprocessing pipeline unchanged, except for one provider-compatibility fix in autocomplete's template dispatch (see `decision.md`, D3).
- Graceful behavior with no key configured: no crash, no stale suggestions, a clear prompt to set one up.
- Error handling for missing/invalid key, invalid/unavailable model, rate limits, network failures, cancellation, and malformed responses.

## Out of scope

- Any provider other than OpenRouter (the existing `ILLM`/`BaseLLM` abstraction already supports others; this extension only wires up OpenRouter).
- Chat/GUI features — already removed from this fork upstream.
- Marketplace *publishing* (icons, marketplace listing, publisher verification, multi-platform `.vsix` builds). Producing a clean, minimal, correctly-packaged `.vsix` via `@vscode/vsce` **is** in scope — see `decision.md` D12-D16 — but publishing it anywhere is not.
- A model picker UI backed by OpenRouter's live model catalog (the model setting is free text; listing/searching models is a natural follow-up, not required here).
- Multi-workspace or remote-dev edge cases beyond what the `IDE` interface already covers.
- Shipping the tree-sitter WASM grammars (`tree-sitter-wasms`, 50MB) in the packaged `.vsix` — import-based context enrichment degrades gracefully without them (see `decision.md` D15); only local `F5` development builds have them (via npm-workspace hoisting).

## User stories

- As a developer, I install the extension, run **"Continue: Set OpenRouter API Key"**, paste my key, and see it validated immediately.
- As a developer, I set `continue.openRouter.model` to whichever OpenRouter model I want (e.g. `anthropic/claude-3.5-sonnet`, `qwen/qwen-2.5-coder-32b-instruct`) and get inline completions from that model as I type.
- As a developer, if my key is missing or gets rejected (401), I see a clear, actionable message instead of a silent failure or a raw stack trace.
- As a developer, if OpenRouter rate-limits me or I run out of credits, I see a message explaining that, not a generic error.
- As a developer using a NextEdit-capable model available through OpenRouter (e.g. `inception/mercury-coder`), I get NextEdit suggestions the same way I would with any other provider.
- As a developer, cancelling a completion (by continuing to type) never leaves a stale suggestion on screen.

## Success criteria

- Extension activates cleanly with no API key configured (no throw, no stale UI), and prompts the user to set one.
- After setting a valid key, inline completions stream from OpenRouter for both an Anthropic-family model and a non-Anthropic model (the latter exercises the template-dispatch fix — see `decision.md` D3).
- NextEdit continues to function unaffected when a NextEdit-capable model is selected.
- Invalid key, invalid model, rate-limit, network-failure, and cancellation cases all produce a classified, user-legible message rather than an unhandled exception or silent no-op.
- `npm test`, `npm run test:extension`, `npm run lint`, and `npm run typecheck` (both `core/` and `extension/`) all pass.
- `npm run package --workspace=extension` produces a `.vsix` containing only the packaged bundle, `sqlite3`'s runtime files, `package.json`, `README.md`, and `LICENSE` — no source files, tests, build tooling, or unrelated repo content (verified — see `decision.md` D12-D14, `tests.md`).
