# Flow: Continue (OpenRouter)

## Autocomplete request flow

```
keystroke in editor
  └─ vscode.languages.registerInlineCompletionItemProvider callback
       (ContinueCompletionProvider.provideInlineCompletionItems
        — core/vscode-test-harness/src/autocomplete/completionProvider.ts, unchanged)
  └─ CompletionProvider.provideInlineCompletionItems
       (core/autocomplete/CompletionProvider.ts, unchanged)
       ├─ HelperVars.create()               — gathers prefix/suffix, AST, cursor context
       ├─ ContextRetrievalService /
       │  getAllSnippets*                    — imports, root-path, clipboard, recent edits, etc.
       ├─ renderPromptWithTokenLimit()        — core/autocomplete/templating/index.ts
       │    └─ getTemplateForModel(model, llm.providerName)   *** provider-aware (new) ***
       │         → forces holeFillerTemplate when providerName === "openrouter"
       │         → otherwise unchanged substring dispatch
       └─ CompletionStreamer.streamCompletionWithFilters()
            └─ llm.supportsFim()? no (OpenRouter never does)
            └─ llm.streamComplete(prompt, signal, { raw: true, ... })
                 (core/llm/index.ts BaseLLM.streamComplete)
                 └─ OpenRouter._streamComplete()      — core/llm/llms/OpenRouter.ts (new)
                      └─ openaiAdapter.chatCompletionStream(...)
                           (OpenRouterApi extends OpenAIApi, openai SDK client,
                            core/llm/openai-adapters/apis/OpenRouter.ts — pre-existing)
                                └─ HTTPS POST https://openrouter.ai/api/v1/chat/completions
                                     (Authorization: Bearer <user's key>, stream: true)
            └─ StreamTransformPipeline           — stop tokens, repeat-line/empty-comment filters
       └─ postprocessCompletion()                — blank/repeat/markdown-fence cleanup
  └─ InlineCompletionItem returned to VS Code, with a
     "continue.logAutocompleteOutcome" command attached for acceptance logging
```

Everything below `renderPromptWithTokenLimit`'s template-selection call is untouched by this
work; only *which* prompt template gets chosen changes for OpenRouter, not how the pipeline
consumes it.

## NextEdit request flow

NextEdit does not go through `AutocompleteTemplate.ts` at all — it has its own,
separately-templated pipeline (`core/nextEdit/templating/NextEditPromptEngine.ts`), so the
provider-aware template fix does not apply here and NextEdit's model-name-based provider
selection (`NextEditProviderFactory`, keyed on `mercury-coder`/`instinct` substrings) is
unaffected by which vendor is hosting the model:

```
keystroke → ContinueCompletionProvider.provideInlineCompletionItems (isNextEditActive branch)
  └─ NextEditProvider.getNextEditPrediction()
       ├─ BaseNextEditModelProvider.generatePrompts()   — Instinct or Mercury-specific prompt
       └─ llm.chat([prompts[1]], token, { stream: false })
            (core/llm/index.ts BaseLLM.chat → streamChat, adapter-routed for OpenRouter)
                 └─ HTTPS POST .../chat/completions (stream: false)
       └─ BaseNextEditModelProvider.extractCompletion()  — model-specific response parsing
       └─ Myers diff against the editable region → DiffLine[] → NextEditOutcome
  └─ NextEditWindowManager renders the diff/ghost-text decoration
```

A NextEdit-capable model hosted on OpenRouter (e.g. `inception/mercury-coder`) works with zero
code changes: `modelSupportsNextEdit()` (`core/llm/autodetect.ts`) substring-matches the model
name regardless of vendor prefix.

## Configuration & credential flow

```
"Continue: Set OpenRouter API Key" command
  └─ vscode.window.showInputBox({ password: true })
  └─ validateOpenRouterApiKey(key)   — GET https://openrouter.ai/api/v1/auth/key
       ├─ 401           → reject, show error, do NOT store
       ├─ network error → show warning, store anyway (re-checked on first real use)
       └─ ok             → context.secrets.store("continue.openRouterApiKey", key)
                              └─ fires context.secrets.onDidChange
                                   └─ extension.ts refresh(): dispose old inline-completion
                                      registration, rebuild OpenRouter LLM + MinimalConfigProvider
                                      + ContinueCompletionProvider, re-register

"continue.openRouter.model" setting changed (settings.json / Settings UI)
  └─ vscode.workspace.onDidChangeConfiguration
       └─ extension.ts refresh() (same as above)
```

`MinimalConfigProvider` (`core/autocomplete/MinimalConfig.ts`) captures its config as a static
snapshot — it was not designed for live reconfiguration — so rather than patching that class,
`extension.ts` disposes and rebuilds the whole `ContinueCompletionProvider` registration whenever
the key or model changes. This guarantees no stale, bound-to-an-old-key provider keeps running.

## Error flow

```
OpenRouter HTTP error (401 / 402 / 429 / 400 / 5xx)
  └─ openai SDK throws a typed APIError with a numeric .status
  └─ propagates up through OpenRouter._streamComplete / streamChat / chat (uncaught, by design —
     core/llm/index.ts's _logEnd already classifies success/error/cancelled around every call)
  └─ CompletionProvider.onError / NextEditProvider.onError
       (both configured with ContinueCompletionProvider.onError.bind(this))
  └─ handleLLMError(error)   — core/vscode-test-harness/src/util/errorHandling.ts (extended)
       ├─ has numeric .status?
       │    ├─ 401       → "Invalid OpenRouter API key" + "Set API Key" action button
       │    ├─ 402 / 429 → "rate limit / insufficient credits"
       │    ├─ 400       → "invalid/unavailable model — check continue.openRouter.model"
       │    └─ other     → generic "OpenRouter request failed (status N)"
       │         → returns true (handled)
       └─ no .status (plain Error, e.g. network failure) → falls through to the existing
            generic "Continue Autocomplete Error: <message>" vscode.window.showErrorMessage
            → returns false
```

Cancellation (`AbortError`) and streaming interruptions are handled by the existing,
provider-agnostic machinery and required no changes:
- `AbortSignal` is threaded through every layer (`token.onCancellationRequested` →
  `AbortController.abort()` → passed into `streamComplete`/`chat`/the `openai` SDK call).
- `core/fetch/stream.ts` and `core/llm/index.ts`'s `_logEnd` already classify aborts as
  `"cancelled"`, not `"error"`, and swallow `AbortError` without surfacing it as a user-facing
  failure.
- `handleLLMError` never sees a `.status` on a plain `AbortError`, so it correctly falls through
  and lets the (already cancellation-aware) existing flow handle it.
