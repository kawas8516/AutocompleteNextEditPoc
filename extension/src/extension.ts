import { CompletionProvider } from "core/autocomplete/CompletionProvider";
import { MinimalConfigProvider } from "core/autocomplete/MinimalConfig";
import { modelSupportsNextEdit } from "core/llm/autodetect";
import { OpenRouter } from "core/llm/llms/OpenRouter";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { DEFAULT_AUTOCOMPLETE_OPTS } from "core/util/parameters";
import { JumpManager } from "core/vscode-test-harness/src/activation/JumpManager";
import { NextEditWindowManager } from "core/vscode-test-harness/src/activation/NextEditWindowManager";
import { ContinueCompletionProvider } from "core/vscode-test-harness/src/autocomplete/completionProvider";
import {
  initStatusBar,
  setupStatusBar,
  StatusBarStatus,
} from "core/vscode-test-harness/src/autocomplete/statusBar";
import * as vscode from "vscode";

import { showStatusBarMenu } from "./statusBarMenu";
import { VsCodeIde } from "./VsCodeIde";

export const OPENROUTER_API_KEY_SECRET = "runahead.openRouterApiKey";
/**
 * The pre-rename secret key. SecretStorage is keyed by string, so renaming
 * the extension orphaned any key stored by an earlier build - the value is
 * still in the OS credential store, just under a name nothing reads.
 * `migrateApiKeySecret()` moves it across once, on activation.
 */
const LEGACY_API_KEY_SECRET = "continue.openRouterApiKey";
const OPENROUTER_AUTH_KEY_URL = "https://openrouter.ai/api/v1/auth/key";
/** Kept in sync with the default in `extension/package.json`. */
const DEFAULT_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";

/**
 * Validates an OpenRouter API key by calling OpenRouter's cheap "auth/key"
 * endpoint. Returns true if the key is accepted, false on a 401, and throws
 * for anything else (network failure, unexpected status) so the caller can
 * distinguish "definitely invalid" from "couldn't check".
 */
export async function validateOpenRouterApiKey(
  apiKey: string,
): Promise<boolean> {
  const response = await fetch(OPENROUTER_AUTH_KEY_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.status === 401) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `OpenRouter key validation failed with status ${response.status}`,
    );
  }
  return true;
}

/**
 * Registers the "Set OpenRouter API Key" command: prompts for a key, eagerly
 * validates it against OpenRouter, and stores it in SecretStorage on
 * success. Storing under `context.secrets` fires `onDidChange`, which
 * `activate()` listens to in order to (re)register the completion provider.
 */
function registerSetApiKeyCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "runahead.setOpenRouterApiKey",
    async () => {
      const apiKey = await vscode.window.showInputBox({
        title: "OpenRouter API Key",
        prompt: "Enter your OpenRouter API key (from openrouter.ai/keys)",
        password: true,
        ignoreFocusOut: true,
      });
      if (!apiKey) {
        return;
      }

      let valid: boolean;
      try {
        valid = await validateOpenRouterApiKey(apiKey);
      } catch (e) {
        vscode.window.showErrorMessage(
          `Runahead: Couldn't validate the OpenRouter API key (network error). Saved it anyway - it will be re-checked on first use. ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        await context.secrets.store(OPENROUTER_API_KEY_SECRET, apiKey);
        return;
      }

      if (!valid) {
        vscode.window.showErrorMessage(
          "Runahead: That OpenRouter API key was rejected (401 Unauthorized). It was not saved.",
        );
        return;
      }

      await context.secrets.store(OPENROUTER_API_KEY_SECRET, apiKey);
      vscode.window.showInformationMessage(
        "Runahead: OpenRouter API key validated and saved.",
      );
    },
  );
}

/**
 * The status bar item's click target (see `statusBar.ts`, which sets
 * `statusBarItem.command` to this id).
 */
function registerConfigMenuCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    "runahead.openTabAutocompleteConfigMenu",
    () =>
      showStatusBarMenu(context, OPENROUTER_API_KEY_SECRET, DEFAULT_MODEL),
  );
}

/**
 * Wraps `CompletionProvider.accept()` / `NextEditLoggingService.accept()` /
 * `.reject()` as VS Code commands. These command IDs are already
 * *referenced* elsewhere in the reused harness code (as the `command` field
 * of returned `InlineCompletionItem`s, and via `vscode.commands.executeCommand`
 * inside `NextEditWindowManager`) but were never registered anywhere in the
 * repo before this extension existed - see decision.md.
 */
function registerLoggingCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "runahead.logAutocompleteOutcome",
      (completionId: string, completionProvider: CompletionProvider) => {
        completionProvider.accept(completionId);
      },
    ),
    vscode.commands.registerCommand(
      "runahead.logNextEditOutcomeAccept",
      (completionId: string, loggingService: NextEditLoggingService) => {
        loggingService.accept(completionId);
      },
    ),
    vscode.commands.registerCommand(
      "runahead.logNextEditOutcomeReject",
      (completionId: string, loggingService: NextEditLoggingService) => {
        loggingService.reject(completionId);
      },
    ),
  ];
}

/**
 * Decides whether the NextEdit experience should be turned on for the
 * currently-selected model.
 *
 * `"auto"` (the default) defers to `modelSupportsNextEdit`, the same check
 * `NextEditProvider` itself uses, so the two can't disagree. `"on"` is an
 * escape hatch for a NextEdit-capable model this build doesn't recognize by
 * name - it cannot make an arbitrary chat model work, because the prompt
 * templates and provider factory are model-specific.
 */
function shouldEnableNextEdit(
  config: vscode.WorkspaceConfiguration,
  llm: OpenRouter,
): boolean {
  const setting = config.get<string>("nextEdit.enabled", "auto");
  if (setting === "on") {
    return true;
  }
  if (setting === "off") {
    return false;
  }
  return modelSupportsNextEdit(llm.capabilities, llm.model, llm.title);
}

/**
 * Builds the `MinimalConfigProvider` + `ContinueCompletionProvider` pair and
 * registers the inline completion provider, using whatever OpenRouter API
 * key/model are configured *right now*. `MinimalConfigProvider` captures its
 * config as a static snapshot (see `core/autocomplete/MinimalConfig.ts`), so
 * there's no dynamic per-request re-read - instead, `activate()` disposes
 * and re-runs this whenever the stored key or model setting changes.
 */
async function registerCompletionProvider(
  context: vscode.ExtensionContext,
  ide: VsCodeIde,
): Promise<vscode.Disposable | undefined> {
  const apiKey = await context.secrets.get(OPENROUTER_API_KEY_SECRET);
  if (!apiKey) {
    setupStatusBar(StatusBarStatus.Disabled);
    return undefined;
  }

  const config = vscode.workspace.getConfiguration("runahead");
  const model = config.get<string>("openRouter.model", DEFAULT_MODEL);

  const llm = new OpenRouter({ apiKey, model });

  const configProvider = new MinimalConfigProvider({
    // The upstream default is `modelTimeout: 150` (ms), which was tuned for
    // local/self-hosted models. It is far too aggressive for a hosted API:
    // `StreamTransformPipeline` feeds this same value to
    // `showWhateverWeHaveAtXMs`, which stops the stream as soon as one
    // non-empty line has been yielded AND the budget is exceeded. Since
    // OpenRouter's time-to-first-token alone typically exceeds 150ms, that
    // truncated every completion to a single line. It also drives
    // `CompletionStreamer`'s hard cancel at `modelTimeout * 2.5`.
    tabAutocompleteOptions: {
      ...DEFAULT_AUTOCOMPLETE_OPTS,
      modelTimeout: config.get<number>("modelTimeout", 5000),
    },
    modelsByRole: { autocomplete: [llm] },
    selectedModelByRole: { autocomplete: llm },
  });

  const provider = new ContinueCompletionProvider(
    configProvider,
    ide,
    /* usingFullFileDiff */ true,
  );

  // NextEdit is a fine-tuned-model feature, not a general capability:
  // `NextEditProviderFactory.createProvider()` throws for anything that isn't
  // Mercury Coder or Instinct, and `NextEditPromptEngine` has templates only
  // for those two. Activating it for a general chat model (the default is
  // Claude) makes `NextEditProvider` bail out, and because plain autocomplete
  // lives in the `else` branch of that check, it would never run at all.
  // So only turn it on when the selected model can actually serve it.
  if (shouldEnableNextEdit(config, llm)) {
    provider.activateNextEdit();
  }

  const registration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider,
  );

  // Honour the user's saved preference rather than force-enabling. The
  // completion gate reads the status bar state, not the setting, so setting
  // `Enabled` unconditionally here would silently re-enable autocomplete on
  // every window reload for anyone who had turned it off.
  setupStatusBar(
    config.get<boolean>("enableTabAutocomplete", true)
      ? StatusBarStatus.Enabled
      : StatusBarStatus.Disabled,
  );

  return registration;
}

/**
 * Moves an API key stored under the pre-rename secret name across to the
 * current one, so upgrading users don't have to re-enter it.
 *
 * Deliberately non-destructive on the read side and idempotent: if the new
 * key already holds a value it wins and the legacy entry is simply deleted,
 * so a user who re-entered their key before upgrading doesn't get it
 * silently replaced by an older one. Safe to delete this function (and its
 * call in `activate`) once no installs predate the rename.
 */
export async function migrateApiKeySecret(
  secrets: vscode.SecretStorage,
): Promise<void> {
  const legacy = await secrets.get(LEGACY_API_KEY_SECRET);
  if (legacy === undefined) {
    return;
  }
  const current = await secrets.get(OPENROUTER_API_KEY_SECRET);
  if (current === undefined) {
    await secrets.store(OPENROUTER_API_KEY_SECRET, legacy);
  }
  await secrets.delete(LEGACY_API_KEY_SECRET);
}

export async function activate(context: vscode.ExtensionContext) {
  const ide = new VsCodeIde();

  // Before anything reads the key. Storing under the new name fires
  // `onDidChange`, which the listener below turns into a provider refresh.
  await migrateApiKeySecret(context.secrets);

  context.subscriptions.push(
    initStatusBar(),
    registerSetApiKeyCommand(context),
    registerConfigMenuCommand(context),
    ...registerLoggingCommands(),
  );

  await NextEditWindowManager.getInstance().setupNextEditWindowManager(
    context,
  );

  // Re-register the completion provider whenever the API key or model
  // changes, so a newly-set/updated key takes effect without a reload, and
  // so no stale provider (bound to an old/invalid key) keeps producing
  // suggestions.
  let currentRegistration: vscode.Disposable | undefined;
  const refresh = async () => {
    currentRegistration?.dispose();
    currentRegistration = await registerCompletionProvider(context, ide);
  };

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === OPENROUTER_API_KEY_SECRET) {
        void refresh();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // These three are read once, when the provider is constructed, so a
      // change only takes effect if the provider is rebuilt.
      // `runahead.enableTabAutocomplete` is deliberately absent: it's read
      // live on every request via the status bar gate, so rebuilding for it
      // would be wasted work.
      if (
        e.affectsConfiguration("runahead.openRouter.model") ||
        e.affectsConfiguration("runahead.nextEdit.enabled") ||
        e.affectsConfiguration("runahead.modelTimeout")
      ) {
        void refresh();
      }
    }),
    { dispose: () => currentRegistration?.dispose() },
  );

  await refresh();

  const hasKey = !!(await context.secrets.get(OPENROUTER_API_KEY_SECRET));
  if (!hasKey) {
    vscode.window
      .showInformationMessage(
        "Runahead: set an OpenRouter API key to enable autocomplete and NextEdit.",
        "Set API Key",
      )
      .then((choice) => {
        if (choice === "Set API Key") {
          void vscode.commands.executeCommand("runahead.setOpenRouterApiKey");
        }
      });
  }
}

export function deactivate() {
  JumpManager.clearInstance();
  NextEditWindowManager.clearInstance();
}
