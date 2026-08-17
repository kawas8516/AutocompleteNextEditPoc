# Architectural Decisions: Continue (OpenRouter)

## D1 — `OpenRouter` extends `BaseLLM` directly, not `OpenAI`

`core/llm/llms/OpenAI.ts` has provider-specific quirks (`useLegacyCompletionsEndpoint`,
o1/gpt-5 special-casing) that other code special-cases by identity: `CompletionProvider.ts:74`
and `NextEditProvider.ts:141` both do `if (llm instanceof OpenAI) { llm.useLegacyCompletionsEndpoint = true; }`,
which would route requests at a raw `completions` endpoint OpenRouter doesn't serve. Extending
`BaseLLM` directly avoids that trap entirely and keeps `OpenRouter.ts` free of unrelated OpenAI
quirks. The existing `OpenRouterApi` adapter (`core/llm/openai-adapters/apis/OpenRouter.ts`,
already present and unused before this work) is picked up automatically via
`static providerName = "openrouter"` → `constructLlmApi()`.

## D2 — `useOpenAIAdapterFor = ["chat", "streamChat"]` only

OpenRouter has no FIM (`fim/completions`) endpoint and no legacy `/completions` endpoint — it
only ever speaks chat-completions. `supportsFim()` is left at `BaseLLM`'s default (`false`), and
`_streamComplete` (autocomplete's non-FIM fallback) is implemented to call the adapter's
`chatCompletionStream` directly — **not** the public `streamChat()` method, because
`streamComplete()`'s caller already logs/token-counts once; re-entering the public, logged
`streamChat()` from inside `_streamComplete` would double-log the interaction and double-count
token usage in `TokensBatchingService`. See `core/llm/llms/OpenRouter.ts`.

## D3 — Provider-aware autocomplete template dispatch

**Problem found during exploration**: `getTemplateForModel(model)`
(`core/autocomplete/templating/AutocompleteTemplate.ts`) substring-matches the model name only.
OpenRouter model IDs are vendor-prefixed (`qwen/qwen-2.5-coder-32b-instruct`,
`mistralai/codestral-2501`, `meta-llama/llama-3.1-70b-instruct`, ...). Several accidentally match
FIM-template branches meant for a raw completions endpoint OpenRouter doesn't expose; others
fall through to the `stableCodeFimTemplate` default — also wrong for a chat-only backend.
Un-fixed, this would send FIM special tokens (e.g. `<fim_prefix>`) as plain chat text and produce
garbage completions for most non-Anthropic OpenRouter models.

**Fix**: `getTemplateForModel(model, providerName?)` gained an early return —
`if (providerName === "openrouter") return holeFillerTemplate;` — mirroring the existing
early-return-override precedent already used by `modelSupportsNextEdit(capabilities, model, title)`
in `core/llm/autodetect.ts`. `providerName` is threaded through the one real call site,
`renderPromptWithTokenLimit()`, which already receives `llm: ILLM | undefined` — no new
parameter needed there, just `llm?.providerName` passed down through `preparePromptContext` →
`getTemplate`. `renderPrompt` (used only for fetching autocomplete-shaped *context* for NextEdit
prompts, not real completions) keeps `providerName` optional/undefined — inert, no behavior
change there.

**Alternative considered and rejected**: a new `ModelCapability` flag (e.g. `usesFimEndpoint`).
Rejected because templating has no existing precedent for consulting `ILLM.capabilities` at all
— it would require *more* new plumbing (extend the type, populate it on `OpenRouter`, thread
`llm.capabilities` into templating) than the 2-file provider-name diff actually implemented.

## D4 — NextEdit gating verified untouched

`modelSupportsNextEdit()` (`core/llm/autodetect.ts`) substring-matches `"mercury-coder"`/
`"instinct"` against `model.toLowerCase()` regardless of vendor prefix. An OpenRouter-hosted
`inception/mercury-coder` therefore already enables NextEdit correctly with **zero code
changes** — verified by reading the matcher, not assumed. NextEdit's own prompt templates
(`core/nextEdit/templating/`) never go through `AutocompleteTemplate.ts`, so D3's fix is
irrelevant to NextEdit.

## D5 — SecretStorage + eager key validation (user-confirmed)

The API key is never written to `settings.json` (plaintext) — it's stored under
`context.secrets` (`vscode.SecretStorage`), set via a dedicated
`continue.setOpenRouterApiKey` command using `showInputBox({ password: true })`.

Eager validation was chosen over lazy (user-confirmed trade-off, see below): on submit, the
extension calls `GET https://openrouter.ai/api/v1/auth/key` with the entered key before storing
it. A 401 rejects and does not store the key. A network failure (not a 401) stores the key
anyway with a warning, since a failed *check* isn't proof the key itself is bad — it will be
re-validated implicitly by the first real completion request.

*Trade-off*: one extra network round-trip at key-set time, in exchange for immediate feedback
instead of a silent failure discovered only on first use. Given the user is already waiting on
the input box to resolve, this was judged worth it.

## D6 — Reconfigure-by-rebuild, not live mutation

`MinimalConfigProvider` (`core/autocomplete/MinimalConfig.ts`) captures its config as a static
object at construction time; it has no live-update mechanism (`onConfigUpdate`/`reloadConfig`
are documented no-op stubs). Rather than patch that class to support dynamic per-request LLM
resolution, `extension.ts` disposes the current `vscode.languages.registerInlineCompletionItemProvider`
registration and rebuilds `OpenRouter` + `MinimalConfigProvider` + `ContinueCompletionProvider`
from scratch whenever the stored API key or the `continue.openRouter.model` setting changes
(`context.secrets.onDidChange` / `vscode.workspace.onDidChangeConfiguration`). This guarantees no
provider bound to a stale/invalid key keeps running or producing suggestions, at the cost of a
brief re-registration on every key/model change (negligible — this only happens on explicit user
reconfiguration, never per-keystroke).

## D7 — `extension/` as a separate npm workspace (user-confirmed)

A new `extension/` package (own `package.json`, `tsconfig.json`, `vitest.config.ts`) holds the
actual loadable VS Code extension, wired into the root via `"workspaces": ["extension"]` in the
root `package.json` so a single `npm install` at the repo root covers both. `core/` stays a pure
library + test harness; nothing there gained `engines.vscode`/`contributes`/a `main` entry.

*Rejected alternative*: folding `activate()`/`contributes` directly into
`core/vscode-test-harness` and the root `package.json`. Rejected because
`core/vscode-test-harness` is explicitly a *test harness* (only ever imported from
`*.vitest.ts` before this work) — conflating "code exercised only under a mocked `vscode`" with
"the actual thing the extension host loads and bundles" would blur that boundary and complicate
the bundler's entry-point story. The two-package cost (a second `package.json`/`tsconfig.json`)
was judged worth the clean separation.

`extension/` imports harness internals via the existing `core/*` path-alias convention (e.g.
`"core/vscode-test-harness/src/autocomplete/completionProvider"`), the same pattern the harness's
own files already use for cross-module imports — no new import convention introduced.

## D8 — esbuild for bundling, not webpack or plain `tsc`

The root `tsconfig.json` is `noEmit: true` (typecheck-only via `tsgo`) with `moduleResolution:
"Bundler"` — a plain `tsc` build was never part of this repo's toolchain. `esbuild` understands
that resolution mode and the `.js`-suffixed-imports-of-`.ts`-files idiom used throughout `core/`
natively, with zero extra config (`extension/esbuild.js`: one `esbuild.build()` call,
`--external vscode`, `format: cjs`, `platform: node`). Webpack would need a full config (loaders,
resolvers) for no benefit over esbuild here, so it was not introduced. `vsce`/marketplace
packaging (`.vsix` generation, publisher verification) was left out — not requested, and the
extension is fully loadable/debuggable via `F5` once `main` + `contributes` are correct.

## D9 — Error classification via duck-typed `.status`, single-provider assumption

`handleLLMError` (`core/vscode-test-harness/src/util/errorHandling.ts`) duck-types the caught
error's numeric `.status` field rather than parsing `error.message` text. This works for free:
`OpenRouter`'s adapter-routed requests go through the real `openai` npm SDK client, which already
throws typed `APIError` subclasses (`AuthenticationError`, `RateLimitError`, `BadRequestError`,
...) carrying `.status` — no custom error-wrapping code needed in `OpenRouter.ts`.

This rests on an explicit **single-provider assumption**: `handleLLMError` unconditionally offers
an OpenRouter-specific "Set API Key" action on any 401 without checking which provider raised it,
because OpenRouter is the only configured provider in this extension. **If a second provider is
ever added, this needs revisiting** — either thread provider identity through the error, or give
each provider its own error-classification hook rather than one global status-code table.

## D10 — `VsCodeIde.ts` and the extension entry point are net-new work

Exploration initially assumed a `VsCodeIde.ts` implementing the `IDE` interface already existed
in `core/vscode-test-harness/`. It did not — only `core/test/FakeIDE.ts` (a test double) existed
anywhere in the repo. `extension/src/VsCodeIde.ts` (real `IDE` implementation backed by
`vscode.workspace`/`vscode.languages`/`vscode.window`) and `extension/src/extension.ts`
(`activate()`/`deactivate()`, command registration, config/secret wiring) were both written from
scratch as part of this work, not adapted from existing code. This correction is recorded here
because it materially changed the size of the implementation versus the initial (incorrect)
assumption that only provider-swap work was needed.

## D11 — Two previously-referenced-but-never-registered command IDs, now registered

`continue.logAutocompleteOutcome` (attached as the `command` field of returned
`InlineCompletionItem`s) and `continue.logNextEditOutcomeAccept`/`continue.logNextEditOutcomeReject`
(invoked via `vscode.commands.executeCommand` inside `NextEditWindowManager`) were referenced
throughout the reused harness code but never registered anywhere in the repo before this
extension existed — there was no `activate()` to register them from.
`extension/src/extension.ts` registers all three as thin wrappers around existing,
already-implemented methods (`CompletionProvider.accept()`, `NextEditLoggingService.accept()`/
`.reject()`) — no new business logic, just the missing command-registration glue.
`continue.acceptJump`/`continue.rejectJump` and the two `continue.nextEditWindow.*` commands
needed no such wrapper — `JumpManager`/`NextEditWindowManager` already register those themselves
once a real `vscode.ExtensionContext` reaches them via `setupNextEditWindowManager(context)`.

---

# Production-readiness cleanup pass

A follow-up pass focused on lightweight/robust/efficient/minimal-footprint, run against the
repo's own `CODE_CLEANUP_INSTRUCTIONS.md` constraint that `core/autocomplete/**`/`core/nextEdit/**`
are strictly off-limits. Priority order throughout: correctness → robustness → efficiency →
footprint.

## D12 — sqlite3 marked `external`, not fixed in `core/autocomplete/**`

Discovered by inspecting the built bundle: `core/autocomplete/util/AutocompleteLruCache.ts`'s
sqlite3-backed result cache opens unconditionally at module load
(`core/autocomplete/CompletionProvider.ts:21`), and the module-level `autocompleteCache` promise
is awaited, unguarded, inside every `provideInlineCompletionItems` call. `sqlite3`'s native
binding loader (the `bindings` package) locates its prebuilt `.node` binary via stack-trace-based
caller-file detection, which esbuild's single-file bundle output defeats (only one `__filename`
exists for the whole bundle) — **this was empirically reproduced**: bundling a bare
`require("sqlite3")` with esbuild and running the output throws
`Error: Could not locate the bindings file`, confirming autocomplete would have been completely
broken in any packaged/bundled build.

Both files live inside protected `core/autocomplete/**` — no code fix there is permitted. Fix:
`extension/esbuild.js` marks `"sqlite3"` `external`, leaving `require("sqlite3")` as a real,
unbundled runtime call. Verified this restores correct behavior (built a minimal repro bundle
with `sqlite3` external, ran it, native binding loaded and a real query succeeded), and then
verified again as part of the full extracted `.vsix` (D14).

## D13 — Lazy `require()` for Bedrock/VertexAI only; `@anthropic-ai/sdk` moved to devDependencies

`core/llm/openai-adapters/index.ts` statically imported all 16 non-OpenAI-compatible provider
adapters. Only `Bedrock.ts` (`@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-providers`)
and `VertexAI.ts` (`google-auth-library`) pull genuinely heavy npm SDKs — every other adapter is
a thin wrapper around the already-bundled `openai` SDK or types-only. Converted just those two
`import`s to function-scoped `require()` inside their own switch case (same synchronous
signature/behavior for `constructLlmApi` and any other consumer of `core` — pure mechanical
relocation, not a rewrite) and marked the three heavy packages `external` in
`extension/esbuild.js`. Safe because this extension's runtime never reaches the `"bedrock"`/
`"vertexai"` cases (it always constructs `OpenRouter`, `providerName = "openrouter"`, and no
UI/config path selects any other provider) — the `require()` calls exist in the bundle but never
execute. Result: `extension/dist/extension.js` dropped from 9.96MB to 7.28MB (dev build), 6.71MB
minified (prod build) — verified by rebuilding and grepping the output for absence of AWS/Google
SDK source (present only as small unresolved `require()` stubs inside the lazily-bundled adapter
chunks).

`@anthropic-ai/sdk` (root `dependencies`) was confirmed types-only across all 4 importing files
(0 bytes in the bundle already) and moved to `devDependencies` — a dependency-list-accuracy fix,
not a size change.

Side effect: knip now flags `BedrockApi`/`VertexAIApi` as "unused exports" (its static analysis
can't see the `require()` calls) — documented as an expected false positive in `not-removed.md`
so a future cleanup pass doesn't delete them.

## D14 — `vsce package` doesn't work out-of-the-box in an npm workspace; custom injection step

Standing up `@vscode/vsce` for real VSIX hygiene (user-confirmed scope for this pass) surfaced a
concrete, empirically-verified incompatibility: `vsce`'s automatic dependency detection
(`--dependencies`, the default) gets confused by this repo's npm workspace hoisting. Running
`vsce ls` from `extension/` did **not** just list `extension/`'s own files — it walked out to
`../` and included the entire repo root (every root-level doc, `legacy_code_rewrite/`,
`package-lock.json`, etc.) plus over a thousand `../node_modules/...` entries covering sqlite3's
full *install-time* dependency tree (`prebuild-install`, `tar`, and their own transitive deps
like `ip-address`/`smart-buffer` — package-time tooling, not runtime code).

`vsce package --no-dependencies` fixes the over-inclusion (confirmed: output narrows to exactly
`README.md`, `package.json`, `LICENSE`, `dist/extension.js`) but was then found to **unconditionally
exclude all of `node_modules`**, with no way to override via `.vscodeignore` negation patterns
(tried `!node_modules/**` + selective re-includes — confirmed ineffective, this is a hardcoded
`vsce` behavior under that flag, not a `.vscodeignore` authoring mistake).

Net: neither flag alone produces a correct package containing exactly `sqlite3`'s runtime files.
Resolution — a small, explicit, auditable pipeline instead of fighting `vsce`'s dependency-walk:

1. `extension/scripts/prepare-native-deps.js` copies only sqlite3's actual runtime files
   (`lib/`, `package.json`, `LICENSE`, the prebuilt `build/Release/node_sqlite3.node` binary — not
   the C source tarball under `deps/`, not the `node-addon-api` build-time headers, not
   `minipass`/`tar`/`prebuild-install`) plus the small pure-JS `bindings`/`file-uri-to-path`
   packages into `extension/node_modules`. Verified minimal by reading `sqlite3`'s own
   `require()` chain directly (`lib/sqlite3.js` → `path`, `events`, `./sqlite3-binding.js`,
   `./trace`; `sqlite3-binding.js` → `require('bindings')('node_sqlite3.node')`) and smoke-testing
   the trimmed set in isolation.
2. `vsce package --no-dependencies` produces a clean base `.vsix` (manifest, README, LICENSE,
   bundle only).
3. `extension/scripts/inject-native-deps.ps1` opens that `.vsix` (it's just a zip with an
   `extension/` top-level prefix) via .NET's `System.IO.Compression.ZipFile` and adds the 3
   prepared packages under `extension/node_modules/...`.

All three steps are chained in `extension/package.json`'s `"package"` script. **Verified
end-to-end, not just asserted**: built the real `.vsix` (final size 3.89MB, 27 entries — no
`src/`, `test/`, dev tooling, or unrelated repo files), extracted it exactly as VS Code would
install it, and successfully `require()`'d `sqlite3` from that extracted layout and ran a real
query against it.

**Residual risk, explicitly not resolved here**: `sqlite3` ships platform-specific prebuilt
binaries; this `.vsix` was built and verified on Windows only. The injection script
(`inject-native-deps.ps1`) is Windows-specific (uses `System.IO.Compression`); a maintainer
packaging on macOS/Linux needs an equivalent (e.g. `zip -r`). Actually installing the produced
`.vsix` into a real, running VS Code instance cannot be done in this sandboxed environment —
that remains a manual verification step before any real distribution.

## D15 — tree-sitter WASM grammars excluded from the packaged VSIX

`node_modules/tree-sitter-wasms` is **50MB** (36 per-language grammar `.wasm` files, several
individually 3-7MB). It's used by `core/util/treeSitter.ts`, consumed unconditionally (not just
behind the `enableStaticContextualization` flag) by `ImportDefinitionsService`/
`RootPathContextService` for import-based autocomplete context — but every consumer already
wraps parser/language loading in try/catch and degrades to "no import-context available" on
failure (confirmed by reading the code, not assumed).

Given the explicit, non-negotiable "minimal packaged extension size" goal, and that this feature
already has graceful degradation built in (unlike sqlite3's cache, whose failure mode was a hard
crash — D12), tree-sitter-wasms was **not** added to the native-deps injection step and is not
included in the `.vsix`. Local `F5` Extension Development Host usage is unaffected (works via
npm-workspace-hoisted root `node_modules`, same as before this pass). Packaged-VSIX installs lose
import-based context enrichment specifically — core completion/NextEdit behavior is unaffected
(confirmed: the main pipeline doesn't depend on tree-sitter).

**This is a real, consequential trade-off surfaced here rather than silently decided during
planning** — the original plan assumed tree-sitter-wasms would be included; this was revised
during implementation once its actual size was measured. If full context-quality parity with
local dev is wanted in packaged installs, either extend the injection scripts to include it
(50MB cost) or curate a smaller subset of grammars (touches `core/util/treeSitter.ts`'s
assumption that any requested grammar might be available — not protected code, but a
product-scope decision beyond this pass's remit).

## D16 — Two safe removals, one test-seam removal

`legacy_code_rewrite/` (~1MB, 43 historical cleanup-effort files) and `MONOREPO_MERGE.md`
(one-time migration record) were deleted — confirmed zero references from any script, test, or
code via grep before removal. `__setMockJumpManagerInstance`
(`core/vscode-test-harness/src/activation/JumpManager.ts`) was removed at the user's explicit
confirmation — confirmed unreferenced by knip and not inside a protected directory; `_instance`
is `public static`, so no access-modifier implications from the removal.

Confirmed **kept**, despite superficially looking removable: `core/autocomplete/filtering/test/NEGATIVE_TEST_CASES/*.txt`
(unreferenced but inside protected `core/autocomplete/**`), `__setMockNextEditProviderInstance`
(inside protected `core/nextEdit/**`), `core/llm/llms/OpenAI.ts` (dead at runtime for this
extension but referenced by protected `instanceof OpenAI` checks).

## D17 — tree-sitter.wasm (core parser runtime) copied into the bundle, found via live testing

Everything in D9-D16 was verified via unit tests, rebuilt bundles, and VSIX inspection — not by
actually running the extension end-to-end. Doing that (a real `code --extensionDevelopmentPath`
Extension Development Host, a real OpenRouter key, typing in a sample file) confirmed the core
feature works — `provideInlineCompletions` round-tripped to OpenRouter successfully (~360ms,
consistent with a real API call), zero errors surfaced to the user — and also surfaced one real
bug static analysis hadn't caught: a single `[error] RuntimeError: Aborted(...ENOENT...
'extension\dist\tree-sitter.wasm')`, thrown from the bundled code inside `web-tree-sitter`'s
loader.

`web-tree-sitter`'s JS wrapper gets bundled by esbuild (it's not marked `external`), but esbuild
can't inline a `.wasm` binary into JS. `core/util/treeSitter.ts`'s `Parser.init()` calls (no
`locateFile` override) resolve `tree-sitter.wasm` relative to the bundle's own directory at
runtime — `extension/dist/` — but that file was never physically placed there. Confirmed
non-fatal: `getParserForFile`/`getLanguageForFile` (`core/util/treeSitter.ts`, not a protected
directory) both wrap `Parser.init()` in try/catch, and completions kept working normally
afterward — but tree-sitter itself never actually initialized for the whole session, so
AST-based context (`ImportDefinitionsService`/`RootPathContextService`) was silently unavailable,
with `[error]`-level log noise on top.

**Distinct from D15**, not a reversal of it: D15 is about the *per-language grammar files*
(`tree-sitter-wasms`, 50MB, 36 files) — still deliberately excluded from the packaged VSIX, that
tradeoff stands. This is about `web-tree-sitter`'s own **core runtime** (`tree-sitter.wasm`, one
file, ~186KB) — required just to initialize the parser engine at all, independent of which
language grammars are available, and was missing even in **local dev** (D12-D16 only ever
discussed the grammars, not this file).

Fix, same shape as D12 (don't touch `core/util/treeSitter.ts` — it works correctly as designed;
fix at the build layer): `extension/esbuild.js` now copies
`node_modules/web-tree-sitter/tree-sitter.wasm` → `dist/tree-sitter.wasm` after every build (dev
and prod). No VSIX-packaging script changes were needed — `vsce package --no-dependencies`
already includes everything under `dist/` except `*.map` files, so the copied `.wasm` is picked
up automatically (verified: appeared in the packaged `.vsix` listing at 181.29 KB with zero
changes to `.vscodeignore`/`inject-native-deps.ps1`).

Verified directly (not just "should work"): a standalone Node script requiring `web-tree-sitter`
from `extension/dist/` and calling `Parser.init()` succeeded after the fix (it failed with the
same `ENOENT` before). This is the single concrete case in this whole project where an actual
runtime smoke test caught something the type-checker, linter, unit tests, and static bundle
inspection all missed — worth keeping the manual E2E step in the test process for exactly this
class of bug (a required asset silently absent from the bundle).

## D18 — inline completions suppressed by VS Code's suggest widget: settings fix, not code

Another live-testing finding (same spirit as D17): typing a comment describing intent, then
typing a recognized keyword like `function` on the next line, produced no inline completion.
Confirmed with the user that VS Code's own IntelliSense dropdown pops up at exactly that moment.

Root cause, traced to `core/vscode-test-harness/src/autocomplete/completionProvider.ts` (not a
protected directory, but unmodified upstream Continue behavior, not something the OpenRouter work
introduced): the provider gates on `context.selectedCompletionInfo` (lines 169-187, 483-507,
687-709), which VS Code populates whenever its suggest widget has a selection. This isn't just
our own defensive code — it reflects VS Code's actual `InlineCompletionItem` API contract
(documented inline at the call site): when the suggest widget has a selection, an inline
completion is only rendered as a preview if it extends that exact selected text. Since
TypeScript's IntelliSense selects its own suggestion — not something our OpenRouter completion
can be guaranteed to match — VS Code suppresses our ghost text by design whenever the dropdown is
showing, regardless of what our code does.

**No code fix applies here** — loosening our own gate wouldn't help, since the actual constraint
is VS Code's rendering contract, not our logic. Fix is a documented settings recommendation only
(`extension/README.md` Troubleshooting section): reduce `editor.quickSuggestions` so the dropdown
appears less eagerly, giving inline completions room to render. Deliberately **not** set
programmatically via `contributes.configurationDefaults` — that's a global editor setting
affecting every language server, not scoped to this extension; silently overriding it on the
user's behalf would be a surprising side effect on their whole editor setup.

## D19 — no predictions rendered at all: five stacked defects, found by live testing

Live testing revealed that **no prediction of any kind had ever rendered** — and, importantly,
that my earlier D17-era claim that "autocomplete works end-to-end" was **wrong**. I had read the
consistent ~356-378 ms `provider DONE` timings in the ext-host log as OpenRouter network latency.
They were the **350 ms debounce timer** (`debounceDelay: 350`, `core/util/parameters.ts:8`) firing
and then bailing out. No LLM call had ever succeeded. Recorded here because the mistake was
methodological: a plausible-looking number was treated as evidence without checking what else
produces that number.

**The chain, all verified in source:**

1. `extension/src/extension.ts` called `provider.activateNextEdit()` **unconditionally** — my bug,
   introduced when the extension shell was first written (D10/D11).
2. `core/nextEdit/NextEditProvider.ts` gates on `modelSupportsNextEdit()`
   (`core/llm/autodetect.ts`), true **only** for model names containing `mercury-coder` or
   `instinct`. The default `anthropic/claude-3.5-sonnet` fails it.
3. `core/vscode-test-harness/src/autocomplete/completionProvider.ts` then recursively re-invokes
   itself; on the recursion `chainExists` is true, the prefetch queue is empty (it's never filled
   when `usingFullFileDiff: true`), so the chain is deleted and `undefined` returned.
4. Plain autocomplete lives in the `else` branch of `if (this.isNextEditActive)` — therefore
   **unreachable** for every model.
5. Even with that fixed, `modelTimeout: 150` (ms) crippled results:
   `core/autocomplete/filtering/streamTransforms/StreamTransformPipeline.ts` passes
   `helper.options.modelTimeout` into `showWhateverWeHaveAtXMs` — **the wrong option**; the
   `showWhateverWeHaveAtXMs: 300` config value is dead, read by nothing. `lineStream.ts` breaks as
   soon as `elapsed > ms && firstNonWhitespaceLineYielded`, and since OpenRouter's time-to-first-token
   alone exceeds 150 ms, every completion was truncated to exactly one line. Separately
   `CompletionStreamer.ts` hard-cancels the stream at `modelTimeout * 2.5` = 375 ms.

**Fixes** (none of them touching the protected `core/autocomplete/**` / `core/nextEdit/**` trees):

- **NextEdit activation is now conditional** on the same `modelSupportsNextEdit()` check
  `NextEditProvider` itself uses, so the two can't disagree, plus a `continue.nextEdit.enabled`
  setting (`auto` | `on` | `off`). Deliberately **not** implemented by forcing
  `capabilities.nextEdit = true` on an arbitrary model: `NextEditProviderFactory.createProvider()`
  *throws* for anything but Mercury/Instinct, that throw is swallowed by `NextEditProvider`'s
  catch, and the result would be silent `undefined` plus an error toast per keystroke.
- **`modelTimeout` overridden to 5000** from `extension.ts` via `MinimalConfigProvider`'s existing
  `tabAutocompleteOptions`, rather than patching the protected `StreamTransformPipeline`. One value
  fixes both timers since both read it. Exposed as `continue.modelTimeout`. Precedent: the repo's
  own harness fixture already uses `modelTimeout: 5000`.
- **`contributes.keybindings` added** — there were none at all, so `continue.nextEditWindow.accept/hideNextEditSuggestion`
  and `continue.acceptJump`/`rejectJump` (registered at runtime, gated on the `nextEditWindowActive`
  and `continue.jumpDecorationVisible` context keys) were unreachable; Tab fell through to indent.

Verified live afterwards: `provider DONE after 1397ms` — a real network call, versus the previous
invariant ~360 ms debounce-and-bail.

**Debugging note worth keeping:** `console.log`/`console.error` from the bundled extension does
**not** reach `exthost.log`. Diagnostics added that way came back completely empty, which is what
misled the first round of investigation. (The D17 tree-sitter `RuntimeError` reached the log via
the extension host's uncaught-error handler, not via `console.*`.) Use a `vscode.OutputChannel` or
`fs.appendFileSync` for in-editor debugging instead.

## D20 — `CodeRenderer` reimplemented without dependencies

`core/util/CodeRenderer.ts` was a stub returning `"data:image/svg+xml;base64,"` — a valid URI with
a **zero-byte payload**. `NextEditWindowManager` feeds it to a `before.contentIconPath` decoration,
so NextEdit's non-FIM (multi-line edit) preview was silently invisible: no error, no log, nothing
drawn. Git history shows a real 445-line implementation was deleted in `64363ba75`; it used
**shiki + `@shikijs/transformers` + jsdom** to render syntax-highlighted HTML into SVG.

Reverting that would mean re-adding three heavy dependencies, directly undoing the
minimal-footprint work of D13/D15. Instead the renderer is now **hand-rolled SVG with zero new
dependencies**, following the working precedent already in this repo —
`JumpManager._createSvgJumpIcon()` builds its SVG with a template literal and `Buffer.from(...).toString("base64")`
("Create SVG manually without svg-builder dependency").

It renders one `<text>` per line from the `newDiffLines: DiffLine[]` it already receives, colored
and prefixed by diff type (`new` → green `+`, `old` → red `-`, `same` → grey), on a rounded
translucent panel, with local XML escaping (the original's `escapeForSVG` helper no longer exists).
All of `NextEditWindowManager`'s sizing/positioning/z-index plumbing is untouched — this is a
single-function replacement. **Syntax highlighting is the one thing lost**, which is an acceptable
trade for a preview tooltip whose actual job is showing *what changed*.

Verified by rendering a sample diff: 646 bytes of well-formed SVG with correct escaping of `<`,
`>`, `&` and quotes, versus 0 bytes before.

## D21 — status bar menu, and the three defects that had to be fixed to make it work

The status bar item always pointed at `continue.openTabAutocompleteConfigMenu`, but that command
was a stub: a one-option QuickPick that flipped `enableTabAutocomplete`. Replaced with a
Copilot-style menu (`extension/src/statusBarMenu.ts`): autocomplete toggle, NextEdit toggle,
change API key, change model, reset settings, reset cache. Built with `showQuickPick` over
`QuickPickItem[]` (separators are supported there since VS Code 1.64, and `engines.vscode` is
`^1.80.0`) rather than `createQuickPick`, so VS Code owns disposal and the menu can't become a
second instance of the leak below.

Building it surfaced three pre-existing defects, all of which would have made the menu appear
broken:

1. **Toggles wouldn't take effect.** The `onDidChangeConfiguration` handler in `activate()`
   watched only `continue.openRouter.model`, but `nextEdit.enabled` and `modelTimeout` are read
   once when the provider is constructed. Broadened the watcher to all three.
   `enableTabAutocomplete` is deliberately excluded — it's read live per-request via the status
   bar gate, so rebuilding the provider for it would be wasted work.

2. **Unbounded listener leak.** `setupStatusBar()` registered a *new*
   `onDidChangeConfiguration` listener on every call. It runs twice per completion request (once
   on entry at `completionProvider.ts:423`, once via `stopStatusBarLoading`'s 100 ms timer), and
   the listener itself re-entered `setupStatusBar` — so every config change **doubled** the live
   count. Superlinear, not merely linear. The `StatusBarItem` was never disposed either. Fixed
   with a new `initStatusBar(): vscode.Disposable` that registers the listener exactly once and
   owns teardown of the item, the listener, and the pending timer.

   Important subtlety: that listener is **load-bearing, not incidental**. Because
   `provideInlineCompletionItems` gates on `getStatusBarStatus()` rather than reading the setting,
   the leaked listener was the only thing making the `enableTabAutocomplete` setting work at all.
   "Fixing" the leak by deleting the listener would have silently broken the toggle — hence
   register-once rather than remove, with a regression test asserting the toggle still applies
   afterwards.

3. **`enableTabAutocomplete` ignored at startup.** Nothing read the setting during `activate()`;
   the status bar was set to `Enabled` unconditionally once a provider registered. A user who
   turned autocomplete off got it silently re-enabled on every window reload — it only *seemed*
   to work because the leaked listener caught later changes. `registerCompletionProvider` now
   honours the saved value.

**Reset semantics** (user-chosen): two separate actions rather than one "reset all", and **neither
touches the API key** — it has its own Change action, and silently discarding a validated
credential during a "reset settings" would be a surprising loss. Reset Settings clears both Global
*and* Workspace scopes, since a workspace override would otherwise shadow the reset and look like
a no-op.

**Reset Cache** can't call into `AutocompleteLruCache` — it exposes no clear method and lives in
the protected `core/autocomplete/**` tree. Instead the menu opens the same sqlite file (path from
the unprotected `core/util/paths.ts`) and runs `DELETE FROM cache`. Deleting the *file* is not an
option: the running provider holds an open handle. WAL mode (already enabled by the cache) makes
the second connection safe and the delete immediately visible. Uses the `sqlite`/`sqlite3` deps
already added in D12 — no new dependencies.

Both the leak fix and the NextEdit gating were **mutation-tested**: reintroducing each original
bug makes the corresponding tests fail, so the coverage is proven rather than assumed.

## Assumptions & known limitations

- `extension/package.json`'s `publisher` is `"kawas8516"`, matching this fork's GitHub account
  (updated from an earlier `"continue-dev"` placeholder, which would have wrongly implied
  ownership by the real Continue Dev org). If this is ever published to the Marketplace,
  `"kawas8516"` must first be a registered publisher ID there.
- The default model (`anthropic/claude-3.5-sonnet`) is a reasonable default, not a
  recommendation of any particular OpenRouter pricing tier.
- No OpenRouter model catalog / QuickPick picker is implemented — `continue.openRouter.model` is
  free text. A follow-up could call OpenRouter's `/models` endpoint (already exposed by
  `BaseLlmApi.list()` in the adapter layer) to back a picker.
- `deactivate()` clears the `JumpManager`/`NextEditWindowManager` singletons; other singletons
  reused from the harness (`NextEditProvider`, `PrefetchQueue`, `NextEditLoggingService`) are not
  explicitly torn down on deactivate, consistent with how the harness already manages them —
  VS Code's process teardown handles the rest.
- Multi-platform `sqlite3` binaries and real `.vsix`-install verification are out of reach in
  this sandboxed environment (D14) — treat as required manual steps before distributing a build.
- NextEdit against `inception/mercury-coder` **via OpenRouter** is unverified end-to-end. Model-name
  matching satisfies all three gates (`modelSupportsNextEdit`, `NextEditProviderFactory`,
  `getTemplateForModel`), but Continue's native `InceptionApi` routes NextEdit to a dedicated
  `edit/completions` endpoint using a `<|!@#IS_NEXT_EDIT!@#|>` sentinel, which OpenRouter does not
  expose — our `OpenRouter` class sends plain chat-completions instead. Whether Mercury's
  OpenRouter listing honours the same prompt contract has not been tested.
- The default model is a **free-tier** model (`nvidia/nemotron-3-nano-30b-a3b:free`) so the
  extension works on a free OpenRouter account. Free models are rate-limited (commonly ~20
  req/min), and autocomplete is a high-frequency caller — sustained typing can trigger 429s, which
  surface via D9's error classification. Users with credits should pick a stronger model.
- The packaged `.vsix` includes the tree-sitter core runtime (`tree-sitter.wasm`, D17) but not
  the per-language grammar files (`tree-sitter-wasms`, D15) — the parser engine initializes
  cleanly, but AST-based import-context enrichment for any given language is still local-dev-only
  unless a maintainer extends the packaging scripts to include grammars too.
