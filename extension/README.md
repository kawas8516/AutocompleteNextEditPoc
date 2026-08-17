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
| `continue.openRouter.model` | OpenRouter model ID used for completions. | `anthropic/claude-3.5-sonnet` |

## Commands

| Command | Description |
|---|---|
| `Continue: Set OpenRouter API Key` | Prompt for and securely store your OpenRouter API key. |
| `Continue: Open Autocomplete Config Menu` | Enable/disable autocomplete from a quick pick. |

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

## Notes

- This extension is freeware — you bring your own OpenRouter API key and pay OpenRouter directly for usage. No telemetry, no paid tiers, no proprietary services.
- Built on the [Continue](https://continue.dev) autocomplete/NextEdit engine, with OpenRouter as the sole LLM provider.

See the repository root for `prd.md` (product scope), `flow.md` (technical data flow), and `decision.md` (architectural rationale).
