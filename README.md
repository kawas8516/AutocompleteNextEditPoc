# Runahead

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/kawas8516/runahead)
[![License: Apache 2.0](https://img.shields.io/github/license/kawas8516/runahead)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.80.0-blue?logo=visualstudiocode)](extension/package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen?logo=node.js)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)](tsconfig.json)
[![Issues](https://img.shields.io/github/issues/kawas8516/runahead)](https://github.com/kawas8516/runahead/issues)
[![Last commit](https://img.shields.io/github/last-commit/kawas8516/runahead)](https://github.com/kawas8516/runahead/commits)

AI-powered autocomplete and NextEdit for VS Code — bring your own [OpenRouter](https://openrouter.ai) API key and pick any model. Freeware: no telemetry, no paid tiers, no proprietary services. You pay OpenRouter directly for what you use.

Built on top of a trimmed fork of [Continue](https://github.com/continuedev/continue)'s autocomplete/NextEdit engine, with OpenRouter wired in as the LLM provider.

## What's in this repo

- **`extension/`** — the actual, loadable VS Code extension. This is what you install/package.
- **`core/`** — the underlying autocomplete/NextEdit engine (context gathering, prompt templating, streaming, filtering, LLM provider abstraction). A general-purpose library `extension/` consumes a slice of.

See [`prd.md`](prd.md) (scope), [`flow.md`](flow.md) (request/data flow), and [`decision.md`](decision.md) (architectural rationale) for how the two fit together and why things are built the way they are.

## Quick start

1. Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys).
2. Build and install the extension (see [`extension/README.md`](extension/README.md) for full setup, settings, and commands).
3. Run **"Runahead: Set OpenRouter API Key"** and paste it in — stored securely via VS Code's `SecretStorage`, never written to `settings.json` or logged.
4. (Optional) Set `runahead.openRouter.model` to any [OpenRouter model](https://openrouter.ai/models).
5. Start typing.

## Features

### 🎯 Autocomplete

- Context-aware completions: analyzes surrounding code, imports, and recently edited files
- Multi-line support: generates complete code blocks, not just single lines
- Smart filtering: removes invalid completions using AST analysis and bracket matching
- LRU caching and debouncing to keep requests fast and infrequent
- Tree-sitter integration for syntax-aware context

### ✨ NextEdit

- Predictive edits across multiple locations based on your recent changes
- Full-file and partial-file diff modes
- Jump navigation between edit regions, with intelligent cursor placement

## Development

```bash
git clone https://github.com/kawas8516/runahead.git
cd runahead
npm install          # installs both the core/ workspace and extension/

npm test              # core/ test suite
npm run test:extension  # extension/ test suite
npm run lint           # eslint, core/ + extension/
npm run typecheck      # tsgo, core/ (root tsconfig)
cd extension && npx tsgo --noEmit   # tsgo, extension/ (its own tsconfig)

cd extension
npm run build          # dev bundle (esbuild, with sourcemap)
npm run package         # production bundle + .vsix (see decision.md D12-D14 for how native deps are handled)
```

See [`tests.md`](tests.md) for a fast essential-checks list vs. the full maintainer suite.

## Repository structure

```
.
├── core/                       # Autocomplete & NextEdit engine (general-purpose library)
│   ├── autocomplete/           # Autocomplete feature
│   ├── nextEdit/                # NextEdit feature
│   ├── llm/                     # LLM provider abstraction + adapters (incl. OpenRouter)
│   ├── diff/                    # Myers diff algorithm
│   ├── util/, indexing/, fetch/ # Shared utilities
│   └── vscode-test-harness/     # VS Code integration glue, consumed by extension/
├── extension/                  # The real, loadable VS Code extension
│   ├── src/                     # activate()/deactivate(), IDE implementation
│   ├── scripts/                 # Packaging helpers (native-dependency handling)
│   └── package.json             # Extension manifest
├── tree-sitter/                # Tree-sitter query files
├── prd.md, flow.md, decision.md, tests.md   # Docs of record for this extension
├── README.md, ARCHITECTURE.md, API_REFERENCE.md, EXAMPLES.md   # core/ library docs
└── package.json                # Root workspace configuration
```

## Documentation

- [`prd.md`](prd.md) — product scope and user-facing behavior for the extension.
- [`flow.md`](flow.md) — end-to-end request/data flow (context → prompt → completion → streaming → filtering).
- [`decision.md`](decision.md) — architectural decisions and rationale, including the production-readiness cleanup pass.
- [`tests.md`](tests.md) — essential vs. full test checklist.
- [`extension/README.md`](extension/README.md) — setup, settings, and commands for the extension itself.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), [`API_REFERENCE.md`](API_REFERENCE.md), [`EXAMPLES.md`](EXAMPLES.md) — deeper reference for `core/` as a standalone library.

## License & credits

Apache-2.0 — see [`LICENSE`](LICENSE). Runahead is a derivative of [Continue](https://github.com/continuedev/continue) (Copyright Continue Dev, Inc.), trimmed down to autocomplete/NextEdit only, with a VS Code extension and OpenRouter integration added on top. Original project: https://github.com/continuedev/continue · Docs: https://docs.continue.dev

Runahead is not affiliated with or endorsed by Continue Dev, Inc. "Continue" is their name, not ours — Apache-2.0 licenses the code, not the trademark.

## Support

Open an issue on [this repository](https://github.com/kawas8516/runahead/issues) for questions about the OpenRouter extension itself. For questions about the underlying Continue engine, see https://docs.continue.dev.
