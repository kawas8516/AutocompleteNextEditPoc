import { beforeEach, describe, expect, it, vi } from "vitest";

const { onDidChangeConfiguration, createStatusBarItem, getConfiguration, dispose } =
  vi.hoisted(() => {
    const dispose = vi.fn();
    return {
      dispose,
      onDidChangeConfiguration: vi.fn(
        (_listener: (e: { affectsConfiguration: () => boolean }) => void) => ({
          dispose,
        }),
      ),
      createStatusBarItem: vi.fn(() => ({
        text: "",
        tooltip: "",
        command: "",
        show: vi.fn(),
        dispose,
      })),
      getConfiguration: vi.fn(() => ({ get: vi.fn(() => true) })),
    };
  });

vi.mock("vscode", () => ({
  window: { createStatusBarItem },
  workspace: { onDidChangeConfiguration, getConfiguration },
  StatusBarAlignment: { Right: 2 },
}));

import {
  getStatusBarStatus,
  initStatusBar,
  setupStatusBar,
  StatusBarStatus,
} from "../src/autocomplete/statusBar";

describe("status bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: setupStatusBar used to register a config listener on every
  // call. It runs twice per completion request (once on entry, once via
  // stopStatusBarLoading's timer), and the listener re-entered setupStatusBar,
  // so each config change doubled the count. A typing session leaked hundreds
  // of listeners.
  it("registers the config listener exactly once no matter how often setupStatusBar runs", () => {
    const disposable = initStatusBar();
    expect(onDidChangeConfiguration).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 50; i++) {
      setupStatusBar(StatusBarStatus.Enabled);
      setupStatusBar(undefined, true);
    }

    expect(onDidChangeConfiguration).toHaveBeenCalledTimes(1);
    disposable.dispose();
  });

  it("creates only one status bar item across repeated setupStatusBar calls", () => {
    const disposable = initStatusBar();

    for (let i = 0; i < 10; i++) {
      setupStatusBar(StatusBarStatus.Enabled);
    }

    expect(createStatusBarItem).toHaveBeenCalledTimes(1);
    disposable.dispose();
  });

  // The listener is what makes `runahead.enableTabAutocomplete` take effect,
  // since the completion gate reads status rather than the setting. Removing
  // it to "fix the leak" would silently break the toggle.
  it("still applies enableTabAutocomplete changes after the leak fix", () => {
    const disposable = initStatusBar();
    const handler = onDidChangeConfiguration.mock.calls[0][0];

    getConfiguration.mockReturnValue({ get: vi.fn(() => false) });
    handler({ affectsConfiguration: () => true });
    expect(getStatusBarStatus()).toBe(StatusBarStatus.Disabled);

    getConfiguration.mockReturnValue({ get: vi.fn(() => true) });
    handler({ affectsConfiguration: () => true });
    expect(getStatusBarStatus()).toBe(StatusBarStatus.Enabled);

    disposable.dispose();
  });

  it("disposes the listener and the status bar item on teardown", () => {
    const disposable = initStatusBar();
    setupStatusBar(StatusBarStatus.Enabled);

    disposable.dispose();

    // One for the config listener, one for the status bar item.
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(getStatusBarStatus()).toBeUndefined();
  });
});
