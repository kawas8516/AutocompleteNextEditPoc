import * as vscode from "vscode";

import {
  RUNAHEAD_WORKSPACE_KEY,
  getRunaheadWorkspaceConfig,
} from "../util/workspaceConfig";

export enum StatusBarStatus {
  Disabled,
  Enabled,
  Paused,
}

const statusBarItemText = (
  status: StatusBarStatus | undefined,
  loading?: boolean,
  error?: boolean,
) => {
  if (error) {
    return "$(alert) RunAhead (config error)";
  }

  let text: string;
  switch (status) {
    case undefined:
      if (loading) {
        text = "$(loading~spin) RunAhead";
      } else {
        text = "RunAhead";
      }
      break;
    case StatusBarStatus.Disabled:
      text = "$(circle-slash) RunAhead";
      break;
    case StatusBarStatus.Enabled:
      text = "$(check) RunAhead";
      break;
    case StatusBarStatus.Paused:
      text = "$(debug-pause) RunAhead";
      break;
    default:
      text = "RunAhead";
  }

  // Append Next Edit indicator if enabled.
  const nextEditEnabled = true; //MINIMAL_REPO - was configurable
  if (nextEditEnabled) {
    text += " (NE)";
  }

  return text;
};

const statusBarItemTooltip = (status: StatusBarStatus | undefined) => {
  switch (status) {
    case undefined:
    case StatusBarStatus.Disabled:
      return "Click to enable tab autocomplete";
    case StatusBarStatus.Enabled: {
      const nextEditEnabled = true; //MINIMAL_REPO - was configurable
      return nextEditEnabled
        ? "Next Edit is enabled"
        : "Tab autocomplete is enabled";
    }
    case StatusBarStatus.Paused:
      return "Tab autocomplete is paused";
  }
};

let statusBarStatus: StatusBarStatus | undefined = undefined;
let statusBarItem: vscode.StatusBarItem | undefined = undefined;
let statusBarFalseTimeout: NodeJS.Timeout | undefined = undefined;
let statusBarError: boolean = false;

export function stopStatusBarLoading() {
  statusBarFalseTimeout = setTimeout(() => {
    setupStatusBar(StatusBarStatus.Enabled, false);
  }, 100);
}

/**
 * TODO: We should clean up how status bar is handled.
 * Ideally, there should be a single 'status' value without
 * 'loading' and 'error' booleans.
 */
export function setupStatusBar(
  status: StatusBarStatus | undefined,
  loading?: boolean,
  error?: boolean,
) {
  if (loading !== false) {
    clearTimeout(statusBarFalseTimeout);
    statusBarFalseTimeout = undefined;
  }

  // If statusBarItem hasn't been defined yet, create it
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
    );
  }

  if (error !== undefined) {
    statusBarError = error;

    if (status === undefined) {
      status = statusBarStatus;
    }
  }

  statusBarItem.text = statusBarItemText(status, loading, statusBarError);
  statusBarItem.tooltip = statusBarItemTooltip(status ?? statusBarStatus);
  statusBarItem.command = "runahead.openTabAutocompleteConfigMenu";

  statusBarItem.show();
  if (status !== undefined) {
    statusBarStatus = status;
  }
}

/**
 * Registers the one-time wiring the status bar needs, and returns a disposable
 * that tears it all down.
 *
 * This exists because `setupStatusBar` used to register the config listener
 * below itself. Since `setupStatusBar` is called on every completion request
 * (and again ~100ms later via `stopStatusBarLoading`), that leaked two
 * listeners per keystroke - and because the listener re-entered
 * `setupStatusBar`, every config change doubled the count. Registering here
 * instead keeps exactly one listener for the lifetime of the extension.
 *
 * The listener is load-bearing, not incidental: it is what makes the
 * `runahead.enableTabAutocomplete` setting take effect, since
 * `provideInlineCompletionItems` gates on `getStatusBarStatus()` rather than
 * reading the setting directly.
 */
export function initStatusBar(): vscode.Disposable {
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(RUNAHEAD_WORKSPACE_KEY)) {
      const enabled = getRunaheadWorkspaceConfig().get<boolean>(
        "enableTabAutocomplete",
      );
      if (enabled && statusBarStatus === StatusBarStatus.Paused) {
        return;
      }
      setupStatusBar(
        enabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled,
      );
    }
  });

  return {
    dispose: () => {
      configListener.dispose();
      // A queued callback would otherwise fire after teardown and re-show a
      // disposed item.
      clearTimeout(statusBarFalseTimeout);
      statusBarFalseTimeout = undefined;
      statusBarItem?.dispose();
      statusBarItem = undefined;
      statusBarStatus = undefined;
      statusBarError = false;
    },
  };
}

export function getStatusBarStatus(): StatusBarStatus | undefined {
  return statusBarStatus;
}
