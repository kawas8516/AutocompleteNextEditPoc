# Changelog

All notable changes to **Runahead** are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-18

First packaged build. Inline AI autocomplete for VS Code running on any
OpenRouter model with your own API key.

Built on [Continue](https://github.com/continuedev/continue)'s autocomplete and
NextEdit engine (Apache-2.0), with the inference layer replaced by OpenRouter
and the chat, agent, GUI, and telemetry surfaces removed. Runahead is not
affiliated with or endorsed by Continue Dev, Inc.

> **Naming.** Pre-release builds of this extension were called
> "Continue (OpenRouter)" and used a `continue.*` settings and command
> namespace. Apache-2.0 licenses the code but explicitly not the trademark
> (§6), so the project was renamed before publication. If you ran one of
> those builds, everything moved to `runahead.*` and commands now read
> "Runahead: …"; your stored API key is migrated automatically on first
> activation, so there is nothing to re-enter.

### Added

- **Inline completions** through OpenRouter, using the existing context,
  prompting, streaming, filtering, and post-processing pipeline unchanged.
- **`OpenRouter` LLM provider** (`core/llm/llms/OpenRouter.ts`). Extends
  `BaseLLM` directly rather than `OpenAI`, so it never trips the
  `instanceof OpenAI` checks that would route requests at a legacy
  `/completions` endpoint OpenRouter does not serve.
- **Secure API key storage.** The key lives in the OS credential store via
  `vscode.SecretStorage`. It is never written to `settings.json` and never
  logged. Set it with the `Runahead: Set OpenRouter API Key` command, which
  validates the key against OpenRouter before saving it.
- **Status bar menu.** Toggle autocomplete, toggle NextEdit, change the API
  key, change the model, reset settings, or clear the completion cache without
  opening a settings file.
- **Settings**: `runahead.enableTabAutocomplete`, `runahead.openRouter.model`,
  `runahead.nextEdit.enabled` (`auto` / `on` / `off`), `runahead.modelTimeout`.
- **Keybindings** for accepting and dismissing NextEdit suggestions and jumps
  (`Tab` / `Esc`), which the underlying engine registered but never exposed.
- **Error handling** for missing or invalid keys, rate limits and insufficient
  credits, unavailable models, network failures, and cancellation, each mapped
  to a specific message rather than a stack trace.
- Landing page under `landing/`, publishable to GitHub Pages with no build step.

### Changed

- **Default model is `nvidia/nemotron-3-nano-30b-a3b:free`**, so the extension
  works on a free OpenRouter account with no credits. Small fast models suit
  keystroke-driven autocomplete better than large slow ones.
- **`modelTimeout` raised from 150 ms to 5000 ms.** The upstream default was
  tuned for local models and truncated every hosted-API completion to a single
  line, because time-to-first-token alone exceeds 150 ms.
- **Autocomplete prompt templates are provider-aware.** OpenRouter model IDs are
  vendor-prefixed (`qwen/qwen-2.5-coder-32b-instruct`), which previously matched
  fill-in-middle templates written for a raw completions endpoint OpenRouter
  does not expose. OpenRouter now always uses the chat-based template.
- **NextEdit activates only for models that support it** (Mercury Coder,
  Instinct). Enabling it for a general chat model made the provider bail out,
  and because plain autocomplete sat in the other branch of that check, nothing
  rendered at all.
- **Bundle reduced from 9.96 MB to 6.41 MB** by lazy-loading the AWS Bedrock and
  Google VertexAI SDKs, which ship inside the upstream engine but are
  unreachable here. Packaged extension is 3.97 MB.
- **Edit-preview renderer rewritten without dependencies.** The original used
  shiki, `@shikijs/transformers`, and jsdom to render highlighted code to SVG;
  it is now hand-built SVG. Syntax colouring in the preview is the only loss.

### Fixed

- **SQLite completion cache broke once bundled.** The native binding is located
  through the `bindings` package, which identifies its caller by stack trace.
  A single-file bundle collapses every module into one filename and defeats
  that lookup, so the cache threw on every completion request. Fixed by leaving
  `sqlite3` external and shipping it as real `node_modules` content.
- **`tree-sitter.wasm` was missing from the bundle.** A bundler cannot inline a
  `.wasm` binary, so the parser never initialised and AST-based context was
  silently unavailable. The file is now copied into `dist/` at build time.
- **`enableTabAutocomplete` was ignored at startup**, silently re-enabling
  autocomplete on every window reload for anyone who had turned it off.
- **Unbounded listener leak in the status bar.** A configuration listener was
  registered on every call, twice per completion, and each configuration change
  doubled the count. It is now registered once and disposed on deactivate.
- Changing `nextEdit.enabled` or `modelTimeout` had no effect until the window
  was reloaded.

### Known limitations

Recorded rather than glossed over. See `decision.md` for the full reasoning.

- **NextEdit through OpenRouter is unverified end to end.** Model-name matching
  works, but Continue's native Inception adapter uses a dedicated
  `edit/completions` endpoint that OpenRouter does not expose, so NextEdit
  prompts go to plain chat completions instead. Whether Mercury's OpenRouter
  listing honours the same contract has not been tested.
- **The packaged build has only been tested on Windows.** `sqlite3` ships
  platform-specific binaries, so other platforms may need per-target builds
  (`vsce package --target`).
- **Not published to the VS Code Marketplace yet.** Install from the `.vsix` or
  build from source.
- The packaged extension omits the tree-sitter language grammars (50 MB), so
  import-based context enrichment is unavailable in packaged installs. Core
  completion is unaffected.
- Four `streamDiff` tests fail on a clean checkout of the upstream engine and
  still do. 879 tests pass.

### Requirements

- VS Code 1.80.0 or newer
- Node 20.19 or newer (only to build from source)
- An [OpenRouter](https://openrouter.ai/keys) API key

[0.1.0]: https://github.com/kawas8516/runahead/releases/tag/v0.1.0
