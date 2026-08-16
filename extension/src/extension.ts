import { CompletionProvider } from "core/autocomplete/CompletionProvider";
import { MinimalConfigProvider } from "core/autocomplete/MinimalConfig";
import { OpenRouter } from "core/llm/llms/OpenRouter";
import { NextEditLoggingService } from "core/nextEdit/NextEditLoggingService";
import { JumpManager } from "core/vscode-test-harness/src/activation/JumpManager";
import { NextEditWindowManager } from "core/vscode-test-harness/src/activation/NextEditWindowManager";
import { ContinueCompletionProvider } from "core/vscode-test-harness/src/autocomplete/completionProvider";
import {
  setupStatusBar,
  StatusBarStatus,
} from "core/vscode-test-harness/src/autocomplete/statusBar";
import * as vscode from "vscode";

import { VsCodeIde } from "./VsCodeIde";

export const OPENROUTER_API_KEY_SECRET = "continue.openRouterApiKey";
const OPENROUTER_AUTH_KEY_URL = "https://openrouter.ai/api/v1/auth/key";

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
    "continue.setOpenRouterApiKey",
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
          `Continue: Couldn't validate the OpenRouter API key (network error). Saved it anyway - it will be re-checked on first use. ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        await context.secrets.store(OPENROUTER_API_KEY_SECRET, apiKey);
        return;
      }

      if (!valid) {
        vscode.window.showErrorMessage(
          "Continue: That OpenRouter API key was rejected (401 Unauthorized). It was not saved.",
        );
        return;
      }

      await context.secrets.store(OPENROUTER_API_KEY_SECRET, apiKey);
      vscode.window.showInformationMessage(
        "Continue: OpenRouter API key validated and saved.",
      );
    },
  );
}

function registerConfigMenuCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    "continue.openTabAutocompleteConfigMenu",
    async () => {
      const config = vscode.workspace.getConfiguration("continue");
      const enabled = config.get<boolean>("enableTabAutocomplete", true);
      const choice = await vscode.window.showQuickPick(
        [enabled ? "Disable autocomplete" : "Enable autocomplete"],
        { title: "Continue Autocomplete" },
      );
      if (choice) {
        await config.update(
          "enableTabAutocomplete",
          !enabled,
          vscode.ConfigurationTarget.Global,
        );
      }
    },
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
      "continue.logAutocompleteOutcome",
      (completionId: string, completionProvider: CompletionProvider) => {
        completionProvider.accept(completionId);
      },
    ),
    vscode.commands.registerCommand(
      "continue.logNextEditOutcomeAccept",
      (completionId: string, loggingService: NextEditLoggingService) => {
        loggingService.accept(completionId);
      },
    ),
    vscode.commands.registerCommand(
      "continue.logNextEditOutcomeReject",
      (completionId: string, loggingService: NextEditLoggingService) => {
        loggingService.reject(completionId);
      },
    ),
  ];
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

  const model = vscode.workspace
    .getConfiguration("continue")
    .get<string>("openRouter.model", "anthropic/claude-3.5-sonnet");

  const llm = new OpenRouter({ apiKey, model });

  const configProvider = new MinimalConfigProvider({
    modelsByRole: { autocomplete: [llm] },
    selectedModelByRole: { autocomplete: llm },
  });

  const provider = new ContinueCompletionProvider(
    configProvider,
    ide,
    /* usingFullFileDiff */ true,
  );
  provider.activateNextEdit();

  const registration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    provider,
  );

  setupStatusBar(StatusBarStatus.Enabled);

  return registration;
}

export async function activate(context: vscode.ExtensionContext) {
  const ide = new VsCodeIde();

  context.subscriptions.push(
    registerSetApiKeyCommand(context),
    registerConfigMenuCommand(),
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
      if (e.affectsConfiguration("continue.openRouter.model")) {
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
        "Continue: set an OpenRouter API key to enable autocomplete and NextEdit.",
        "Set API Key",
      )
      .then((choice) => {
        if (choice === "Set API Key") {
          void vscode.commands.executeCommand("continue.setOpenRouterApiKey");
        }
      });
  }
}

export function deactivate() {
  JumpManager.clearInstance();
  NextEditWindowManager.clearInstance();
}
