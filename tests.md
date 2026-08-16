# Tests

Two tiers. **Essential** is a short, fast checklist anyone (contributor or user verifying their
setup) can run to confirm the OpenRouter integration works. **Full/maintainer** is everything
else — the full suite, individual deep-dive files, and manual verification steps — for deeper
debugging, refactors, or upgrades.

## Essential (run these 6)

All from the repo root unless noted. Each should finish in seconds.

1. **OpenRouter provider behavior**
   ```
   npx vitest run --config core/vitest.config.ts core/llm/llms/OpenRouter.vitest.ts
   ```
   Confirms: `providerName`/`apiBase` defaults, FIM disabled, adapter-only routing, streaming,
   error propagation (e.g. 401), cancellation. 8 tests.

2. **Template-dispatch fix (the OpenRouter-specific pipeline compatibility bug)**
   ```
   npx vitest run --config core/vitest.config.ts core/autocomplete/templating/AutocompleteTemplate.vitest.ts
   ```
   Confirms OpenRouter models always get the chat-based hole-filler template — the regression
   this project exists to prevent (see `decision.md` D3). 5 tests.

3. **Extension activation & wiring**
   ```
   npm run test:extension
   ```
   Confirms: commands register with no key present, no stale provider registers itself, key
   validation flow (accept/reject/dismiss), and that a stored key + model correctly constructs
   an `OpenRouter` LLM and registers the completion provider. 11 tests.

4. **OpenRouter error classification**
   ```
   npx vitest run --config core/vitest.config.ts core/vscode-test-harness/test/errorHandling.vitest.ts
   ```
   Confirms 401/402/429/400/5xx/cancellation all map to the right user-facing message. 9 tests.

5. **Typecheck both packages**
   ```
   npm run typecheck
   cd extension && npx tsgo --noEmit
   ```
   No output = clean.

6. **Extension bundle actually builds**
   ```
   npm run build:extension
   ```
   Confirms `esbuild` can bundle `extension/src/extension.ts` (and everything it pulls in from
   `core/`) into a loadable `extension/dist/extension.js`. This is the one check that would catch
   an import that resolves under `tsgo`'s path aliases but not under esbuild's bundler resolution.

If all six pass, the OpenRouter integration is sound: provider, prompt compatibility, extension
wiring, error handling, types, and the build all check out.

## Full / maintainer suite

Use these when debugging a failure from the essential list, touching the shared `core/`
pipeline, upgrading dependencies, or reviewing a larger change.

### Everything, one command

```
npm test              # full core/ suite (vitest, ~880 tests, ~15s)
npm run test:extension  # extension/ suite
npm run lint           # eslint across core/ + extension/
npm run typecheck      # tsgo, core/ (root tsconfig)
cd extension && npx tsgo --noEmit   # tsgo, extension/ (its own tsconfig)
```

### Known pre-existing failures (not caused by this work)

`core/diff/streamDiff.vitest.ts` has 4 failing tests on a clean checkout of `main`, unrelated to
OpenRouter/extension work (verified by `git stash` and re-running against the unmodified tree
before starting this project). If you see exactly these 4 fail and nothing else new, that's the
pre-existing baseline, not a regression:
- `streamDiff > Mock LLM example` (multiple cases) — `TypeError: Cannot read properties of
  undefined (reading 'split')` in `expectDiff`.

### Individual files touched or added by this work

Run any of these in isolation while iterating:

```
npx vitest run --config core/vitest.config.ts core/llm/llms/OpenRouter.vitest.ts
npx vitest run --config core/vitest.config.ts core/autocomplete/templating/AutocompleteTemplate.vitest.ts
npx vitest run --config core/vitest.config.ts core/vscode-test-harness/test/errorHandling.vitest.ts
npx vitest --config core/vitest.config.ts   # watch mode, core/
cd extension && npx vitest --config vitest.config.ts   # watch mode, extension/
```

### VSIX packaging hygiene

```
cd extension
npm run package   # build:prod -> prepare-native-deps.js -> vsce package --no-dependencies -> inject-native-deps.ps1 (Windows)
```
Confirms the produced `.vsix` contains only what's needed to run: the minified bundle
(`dist/extension.js`, no sourcemap), `sqlite3`'s runtime files (`node_modules/{sqlite3,bindings,file-uri-to-path}`
— curated, not sqlite3's full install-time dependency tree), `package.json`, `README.md`,
`LICENSE`. No `src/`, `test/`, `esbuild.js`, `tsconfig.json`, or unrelated repo content. Inspect
contents without producing a file via `npx vsce ls --no-dependencies` (won't show the injected
native deps, since those are added in the separate post-processing step — see `decision.md` D14
for why `vsce`'s own dependency detection doesn't work in this npm-workspace layout).

To verify the native module actually resolves once packaged (the specific bug D12/D14 fix): unzip
the produced `.vsix` (rename to `.zip` first — Windows' `Expand-Archive` won't take `.vsix`
directly) and `require()` `sqlite3` from the extracted `extension/node_modules/sqlite3` path. This
is the closest available proxy to real activation in a sandboxed/CI environment; actually
installing the `.vsix` into a running VS Code (and on non-Windows platforms) still needs manual
verification — see `decision.md`'s "Assumptions & known limitations."

Bundle size reference (measured during the production-readiness cleanup pass): dev build (with
sourcemap) 7.28MB / prod build (minified, no sourcemap) 6.71MB `dist/extension.js`; final `.vsix`
3.89MB. Before that pass's dependency-lazy-loading fix (D13), the dev build was 9.96MB — the AWS
Bedrock/Google VertexAI SDKs were being bundled despite being unreachable from this extension.

### Whole-pipeline regression check

Anything under `core/autocomplete/`, `core/nextEdit/`, or `core/llm/` that isn't OpenRouter-
specific is still covered by the pre-existing suite — run `npm test` after any change there, not
just the OpenRouter-specific files above, since the goal of this project was to *not* change that
pipeline's behavior for other providers.

### Manual / end-to-end (VS Code Extension Development Host)

Not automatable from the CLI — do this after any change to `extension/src/extension.ts`,
`extension/src/VsCodeIde.ts`, or the `contributes` block in `extension/package.json`:

1. `npm run build:extension`, then open `extension/` in VS Code and press `F5`.
2. In the Extension Development Host: run **"Continue: Set OpenRouter API Key"**.
   - Paste an invalid key → expect a rejection message, key not saved.
   - Paste a valid key → expect a "validated and saved" confirmation.
3. Set `continue.openRouter.model` to an Anthropic-family model (e.g.
   `anthropic/claude-3.5-sonnet`) and confirm inline completions stream in as you type.
4. Set it to a non-Anthropic model (e.g. `qwen/qwen-2.5-coder-32b-instruct`) and confirm
   completions are still coherent (this exercises the template-dispatch fix — without it, this
   model would get a broken FIM-style prompt).
5. Start typing quickly to trigger cancellation of an in-flight completion; confirm no stale
   ghost text is left behind.
6. Clear/corrupt the stored key (or simulate a 401 by temporarily using a bad key) and confirm
   the classified error message + "Set API Key" action button appears, not a raw stack trace.
7. If testing NextEdit: select a NextEdit-capable model available via OpenRouter (e.g.
   `inception/mercury-coder`) and confirm NextEdit suggestions render and can be
   accepted/rejected via the usual Tab/Esc flow.

### Coverage gaps / not tested

Documented rather than silently missing:
- No live-network test hits the real OpenRouter API (by design — all tests mock at the
  `BaseLlmApi`/`fetch` boundary, consistent with the rest of this repo's LLM-layer tests).
- `VsCodeIde.ts`'s individual methods (`gotoDefinition`, `getDocumentSymbols`, etc.) have no
  dedicated unit tests — they're thin, mechanical wrappers around `vscode.commands.executeCommand`
  and are best verified via the manual E2E checklist above rather than mocking every VS Code LSP
  command shape.
- No test exercises `deactivate()`'s interaction with a real `ExtensionContext.subscriptions`
  disposal order — only that it doesn't throw when called directly.
- The packaged `.vsix`'s `sqlite3` native binding is only verified on Windows (this dev
  environment); other platforms need their own build + extraction + `require()` smoke test before
  distributing a build for them (see `decision.md` D14).
- No automated test installs the produced `.vsix` into a real, running VS Code instance — the
  extraction+`require()` smoke test above is the closest available proxy in this environment.
