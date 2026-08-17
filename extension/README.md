# Continue (OpenRouter)

Autocomplete and NextEdit inline completions, powered by [OpenRouter](https://openrouter.ai) with your own API key and model of choice.

## Setup

1. Get an API key from [openrouter.ai/keys](https://openrouter.ai/keys).
2. Run the command **"Continue: Set OpenRouter API Key"** (Ctrl+Shift+P / Cmd+Shift+P) and paste it in. The key is validated immediately and stored in VS Code's secure credential storage — it is never written to `settings.json` and never logged.
3. (Optional) Set `continue.openRouter.model` in your settings to any [OpenRouter model ID](https://openrouter.ai/models), e.g. `anthropic/claude-3.5-sonnet` (default) or `qwen/qwen-2.5-coder-32b-instruct`.
4. Start typing — inline completions stream in as you go.

## Settings

| Setting | Description | Default |
|---|---|---|
| `continue.enableTabAutocomplete` | Enable/disable inline autocomplete suggestions. | `true` |
| `continue.openRouter.model` | OpenRouter model ID used for completions. | `nvidia/nemotron-3-nano-30b-a3b:free` |
| `continue.nextEdit.enabled` | NextEdit multi-location edit prediction: `auto` (only for capable models), `on`, `off`. | `auto` |
| `continue.modelTimeout` | Milliseconds a completion may keep streaming. Raise if suggestions look cut off. | `5000` |

## Status bar menu

Click **Continue** in the status bar to open the control menu:

| Item | What it does |
|---|---|
| **Autocomplete** | Turn inline ghost-text suggestions on or off. |
| **NextEdit** | Turn multi-location edit prediction on (`auto`) or off. Shows whether `auto` is actually active for your current model. |
| **Change API Key** | Set or replace your OpenRouter key (validated before saving). |
| **Change Model** | Switch which OpenRouter model generates completions. |
| **Reset Settings** | Restore all Continue settings to defaults. **Your API key is kept.** |
| **Reset Cache** | Clear cached completions. **Your API key and settings are kept.** |

Both reset actions ask for confirmation first.

The menu offers NextEdit as `auto`/`off` rather than exposing the third `on` value. Forcing
NextEdit onto a model that doesn't support it suppresses ordinary autocomplete too, leaving you
with no suggestions at all — so `on` is only settable in `settings.json`, by people who know they
need it.

## Commands

| Command | Description |
|---|---|
| `Continue: Set OpenRouter API Key` | Prompt for and securely store your OpenRouter API key. |
| `Continue: Open Autocomplete Config Menu` | Enable/disable autocomplete from a quick pick. |

## Choosing a model

Autocomplete fires on nearly every keystroke, so **latency matters more here than raw model
quality**. A small fast model that answers in ~300 ms usually feels far better than a large one
that takes 2 s, even if the large one writes slightly better code.

The default (`nvidia/nemotron-3-nano-30b-a3b:free`) is a small free-tier model, chosen so the
extension works on a free OpenRouter account with no credits.

**If you use `:free` models, be aware of rate limits.** OpenRouter's free tier is rate-limited
(commonly around 20 requests/minute), and continuous typing can exceed that — you'll see the
"rate limit reached" message. If that happens often, either raise
`continue.enableTabAutocomplete` off while doing heavy editing, or switch to a paid model on a
key with credits.

**If your key has credits**, a code-specific model (e.g. `qwen/qwen-2.5-coder-32b-instruct`) or a
strong general model (e.g. `anthropic/claude-3.5-sonnet`) will give noticeably better completions.

## Troubleshooting

**No inline completion appears after typing a keyword (e.g. `function`, `class`, `if`), even
though it works elsewhere.** This is a VS Code editor-level interaction, not a bug in this
extension: when VS Code's own suggestion dropdown (IntelliSense) has a selected item, its inline
completion API only renders a preview if the completion *extends the exact text currently
selected in that dropdown* — otherwise VS Code suppresses it, since Continue's completion can't
generally be guaranteed to match. Typing a recognized language keyword is exactly when that
dropdown tends to pop up.

Fix: reduce how eagerly the dropdown appears automatically, so inline ghost text has room to
show. Add to your `settings.json`:

```jsonc
"editor.quickSuggestions": {
  "other": false,
  "comments": false,
  "strings": false
}
```

You can still trigger IntelliSense manually with Ctrl+Space / Cmd+Space. Alternatively, if you'd
rather keep quick suggestions on by default, just press `Esc` to dismiss an open dropdown before
expecting inline ghost text to appear.

## NextEdit

NextEdit predicts follow-up edits across multiple locations, rather than just completing at the
cursor. It requires a **fine-tuned model** — currently Mercury Coder or Instinct (e.g.
`inception/mercury-coder`); the underlying engine has model-specific prompt templates and will not
work with a general chat model.

`continue.nextEdit.enabled` defaults to `auto`, which turns NextEdit on only when the selected
model supports it and otherwise uses standard inline autocomplete. Setting it to `on` with an
unsupported model produces no suggestions at all, so leave it on `auto` unless you know your model
is NextEdit-capable.

When active: **Tab** accepts a suggestion or jump, **Esc** dismisses it.

## Notes

- This extension is freeware — you bring your own OpenRouter API key and pay OpenRouter directly for usage. No telemetry, no paid tiers, no proprietary services.
- Built on the [Continue](https://continue.dev) autocomplete/NextEdit engine, with OpenRouter as the sole LLM provider.

See the repository root for `prd.md` (product scope), `flow.md` (technical data flow), and `decision.md` (architectural rationale).
