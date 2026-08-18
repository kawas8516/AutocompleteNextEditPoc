import { modelSupportsNextEdit } from "core/llm/autodetect";
import { getTabAutocompleteCacheSqlitePath } from "core/util/paths";
import * as vscode from "vscode";

/** The settings this extension contributes, used by "Reset Settings". */
const CONTINUE_SETTINGS = [
  "enableTabAutocomplete",
  "openRouter.model",
  "nextEdit.enabled",
  "modelTimeout",
] as const;

type MenuAction =
  | "toggleAutocomplete"
  | "toggleNextEdit"
  | "changeApiKey"
  | "changeModel"
  | "resetSettings"
  | "resetCache";

interface MenuItem extends vscode.QuickPickItem {
  /**
   * Dispatch key. Separate from `label` so the handler never has to match on
   * display strings, which change freely as the UI is tweaked.
   */
  action?: MenuAction;
}

function separator(label: string): MenuItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

/**
 * Describes what `nextEdit.enabled` actually resolves to for the current
 * model, so "auto" isn't opaque - NextEdit only works on fine-tuned models
 * (Mercury Coder / Instinct), and "auto" silently means "off" for everything
 * else.
 */
function describeNextEdit(setting: string, model: string): string {
  if (setting === "off") {
    return "Disabled";
  }
  const supported = modelSupportsNextEdit(undefined, model, undefined);
  if (setting === "on") {
    return supported ? "Forced on" : "Forced on - model does not support it";
  }
  return supported ? "Auto - active" : "Auto - inactive for this model";
}

/**
 * Empties the autocomplete completion cache.
 *
 * `AutocompleteLruCache` lives under the protected `core/autocomplete/**`
 * tree and exposes no clear/purge method, so this opens the same database
 * directly and empties the table. Deleting the file instead is not an option:
 * the running provider holds an open handle to it. The cache uses WAL mode,
 * which supports a second connection, and the delete is visible to the
 * existing one.
 */
async function clearCompletionCache(): Promise<void> {
  const { open } = await import("sqlite");
  const sqlite3 = (await import("sqlite3")).default;

  const db = await open({
    filename: getTabAutocompleteCacheSqlitePath(),
    driver: sqlite3.Database,
  });
  try {
    await db.run("DELETE FROM cache");
  } finally {
    await db.close();
  }
}

function buildItems(
  autocompleteEnabled: boolean,
  nextEditSetting: string,
  model: string,
  hasApiKey: boolean,
): MenuItem[] {
  return [
    separator("Suggestions"),
    {
      label: `$(${autocompleteEnabled ? "check" : "circle-slash"}) Autocomplete`,
      description: autocompleteEnabled ? "Enabled" : "Disabled",
      detail: "Inline ghost-text suggestions as you type",
      action: "toggleAutocomplete",
    },
    {
      label: `$(${nextEditSetting === "off" ? "circle-slash" : "check"}) NextEdit`,
      description: describeNextEdit(nextEditSetting, model),
      detail:
        "Predicts follow-up edits across the file. Requires a Mercury Coder or Instinct model.",
      action: "toggleNextEdit",
    },
    separator("Configuration"),
    {
      label: "$(key) Change API Key",
      description: hasApiKey ? "Key stored" : "Not set",
      detail: "Set or replace your OpenRouter API key",
      action: "changeApiKey",
    },
    {
      label: "$(symbol-parameter) Change Model",
      description: model,
      detail: "Pick which OpenRouter model generates completions",
      action: "changeModel",
    },
    separator("Reset"),
    {
      label: "$(discard) Reset Settings",
      detail:
        "Restore all Runahead settings to their defaults. Your API key is kept.",
      action: "resetSettings",
    },
    {
      label: "$(trash) Reset Cache",
      detail: "Clear cached completions. Your API key and settings are kept.",
      action: "resetCache",
    },
  ];
}

async function resetSettings(
  config: vscode.WorkspaceConfiguration,
): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Reset all Runahead settings to their defaults?",
    { modal: true, detail: "Your OpenRouter API key will be kept." },
    "Reset Settings",
  );
  if (confirm !== "Reset Settings") {
    return;
  }

  // Clear both targets - a workspace-level override would otherwise shadow
  // the reset and make it look like nothing happened.
  for (const key of CONTINUE_SETTINGS) {
    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
  }

  vscode.window.showInformationMessage(
    "Runahead: settings reset to defaults.",
  );
}

async function resetCache(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Clear the autocomplete completion cache?",
    {
      modal: true,
      detail: "Your API key and settings are kept. Completions will be regenerated from scratch.",
    },
    "Reset Cache",
  );
  if (confirm !== "Reset Cache") {
    return;
  }

  try {
    await clearCompletionCache();
    vscode.window.showInformationMessage("Runahead: completion cache cleared.");
  } catch (e) {
    // A missing database just means nothing was ever cached - not an error
    // worth alarming the user about, but worth distinguishing from a real
    // failure.
    const message = e instanceof Error ? e.message : String(e);
    vscode.window.showWarningMessage(
      `Runahead: could not clear the completion cache. ${message}`,
    );
  }
}

async function changeModel(
  config: vscode.WorkspaceConfiguration,
  current: string,
): Promise<void> {
  const model = await vscode.window.showInputBox({
    title: "OpenRouter Model",
    prompt: "Model ID to use for completions (see openrouter.ai/models)",
    value: current,
    ignoreFocusOut: true,
  });
  if (model && model !== current) {
    await config.update(
      "openRouter.model",
      model,
      vscode.ConfigurationTarget.Global,
    );
  }
}

/**
 * The menu shown when the status bar item is clicked.
 *
 * Rebuilt on every open so it always reflects current state rather than a
 * snapshot from activation.
 */
export async function showStatusBarMenu(
  context: vscode.ExtensionContext,
  apiKeySecret: string,
  defaultModel: string,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("runahead");
  const autocompleteEnabled = config.get<boolean>(
    "enableTabAutocomplete",
    true,
  );
  const nextEditSetting = config.get<string>("nextEdit.enabled", "auto");
  const model = config.get<string>("openRouter.model", defaultModel);
  const hasApiKey = !!(await context.secrets.get(apiKeySecret));

  const picked = await vscode.window.showQuickPick(
    buildItems(autocompleteEnabled, nextEditSetting, model, hasApiKey),
    { title: "Runahead" },
  );
  if (!picked?.action) {
    return;
  }

  switch (picked.action) {
    case "toggleAutocomplete":
      await config.update(
        "enableTabAutocomplete",
        !autocompleteEnabled,
        vscode.ConfigurationTarget.Global,
      );
      return;

    case "toggleNextEdit":
      // Toggles between "auto" and "off" only. "on" is deliberately not
      // reachable here: forcing NextEdit onto a model that doesn't support it
      // makes the provider factory throw, and since plain autocomplete sits in
      // the other branch of that check, the user would get no suggestions at
      // all with nothing explaining why. "on" stays available in settings.json
      // for anyone who genuinely needs it.
      await config.update(
        "nextEdit.enabled",
        nextEditSetting === "off" ? "auto" : "off",
        vscode.ConfigurationTarget.Global,
      );
      return;

    case "changeApiKey":
      // Reuse the existing command so key validation lives in one place.
      await vscode.commands.executeCommand("runahead.setOpenRouterApiKey");
      return;

    case "changeModel":
      await changeModel(config, model);
      return;

    case "resetSettings":
      await resetSettings(config);
      return;

    case "resetCache":
      await resetCache();
      return;
  }
}
