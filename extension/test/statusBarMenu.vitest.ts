import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  showQuickPick,
  showWarningMessage,
  showInformationMessage,
  showInputBox,
  executeCommand,
  getConfiguration,
} = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showInputBox: vi.fn(),
  executeCommand: vi.fn(),
  getConfiguration: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: {
    showQuickPick,
    showWarningMessage,
    showInformationMessage,
    showInputBox,
  },
  workspace: { getConfiguration },
  commands: { executeCommand },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
}));

// The cache lives behind sqlite; the menu's job is to issue the DELETE, not to
// re-test sqlite itself.
const { dbRun, dbClose, sqliteOpen } = vi.hoisted(() => {
  const dbRun = vi.fn();
  const dbClose = vi.fn();
  return {
    dbRun,
    dbClose,
    sqliteOpen: vi.fn(async () => ({ run: dbRun, close: dbClose })),
  };
});
vi.mock("sqlite", () => ({ open: sqliteOpen }));
vi.mock("sqlite3", () => ({ default: { Database: class {} } }));
vi.mock("core/util/paths", () => ({
  getTabAutocompleteCacheSqlitePath: () => "/fake/autocompleteCache.sqlite",
}));

import { showStatusBarMenu } from "../src/statusBarMenu";

const SECRET = "runahead.openRouterApiKey";
const DEFAULT_MODEL = "nvidia/nemotron-3-nano-30b-a3b:free";

/** Minimal ExtensionContext stand-in - only `secrets` is used by the menu. */
function makeContext(storedKey?: string) {
  return {
    secrets: { get: vi.fn(async () => storedKey) },
  } as any;
}

/** Configures the mocked workspace config and returns the update spy. */
function mockConfig(values: Record<string, unknown> = {}) {
  const update = vi.fn();
  getConfiguration.mockReturnValue({
    get: vi.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
    update,
  });
  return update;
}

/** Opens the menu having pre-selected the item with the given action. */
async function pick(
  action: string,
  opts: { values?: Record<string, unknown>; storedKey?: string } = {},
) {
  const update = mockConfig(opts.values);
  showQuickPick.mockImplementation(async (items: any[]) =>
    items.find((i) => i.action === action),
  );
  await showStatusBarMenu(makeContext(opts.storedKey), SECRET, DEFAULT_MODEL);
  return update;
}

/** Opens the menu and returns the items it offered, without selecting one. */
async function openMenu(
  opts: { values?: Record<string, unknown>; storedKey?: string } = {},
) {
  mockConfig(opts.values);
  let captured: any[] = [];
  showQuickPick.mockImplementation(async (items: any[]) => {
    captured = items;
    return undefined;
  });
  await showStatusBarMenu(makeContext(opts.storedKey), SECRET, DEFAULT_MODEL);
  return captured;
}

function itemFor(items: any[], action: string) {
  const item = items.find((i) => i.action === action);
  if (!item) {
    throw new Error(`no menu item with action "${action}"`);
  }
  return item;
}

describe("status bar menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("menu contents reflect current state", () => {
    it("shows autocomplete as enabled by default and disabled when turned off", async () => {
      expect(
        itemFor(await openMenu(), "toggleAutocomplete").description,
      ).toBe("Enabled");

      const off = await openMenu({
        values: { enableTabAutocomplete: false },
      });
      expect(itemFor(off, "toggleAutocomplete").description).toBe("Disabled");
    });

    it("explains that 'auto' NextEdit is inactive on a model that can't support it", async () => {
      const items = await openMenu({
        values: { "openRouter.model": "anthropic/claude-3.5-sonnet" },
      });
      expect(itemFor(items, "toggleNextEdit").description).toContain(
        "inactive",
      );
    });

    it("shows 'auto' NextEdit as active on a NextEdit-capable model", async () => {
      const items = await openMenu({
        values: { "openRouter.model": "inception/mercury-coder" },
      });
      expect(itemFor(items, "toggleNextEdit").description).toContain("active");
    });

    it("distinguishes a stored API key from a missing one", async () => {
      expect(itemFor(await openMenu(), "changeApiKey").description).toBe(
        "Not set",
      );
      expect(
        itemFor(await openMenu({ storedKey: "sk-x" }), "changeApiKey")
          .description,
      ).toBe("Key stored");
    });

    it("groups items with separators", async () => {
      const items = await openMenu();
      expect(items.some((i) => i.kind === -1 /* Separator */)).toBe(true);
    });
  });

  describe("toggles", () => {
    it("turns autocomplete off when it is currently on", async () => {
      const update = await pick("toggleAutocomplete");
      expect(update).toHaveBeenCalledWith("enableTabAutocomplete", false, 1);
    });

    it("turns autocomplete back on when it is currently off", async () => {
      const update = await pick("toggleAutocomplete", {
        values: { enableTabAutocomplete: false },
      });
      expect(update).toHaveBeenCalledWith("enableTabAutocomplete", true, 1);
    });

    it("toggles NextEdit from auto to off", async () => {
      const update = await pick("toggleNextEdit");
      expect(update).toHaveBeenCalledWith("nextEdit.enabled", "off", 1);
    });

    it("toggles NextEdit from off back to auto", async () => {
      const update = await pick("toggleNextEdit", {
        values: { "nextEdit.enabled": "off" },
      });
      expect(update).toHaveBeenCalledWith("nextEdit.enabled", "auto", 1);
    });

    // Forcing "on" onto an unsupported model makes NextEditProviderFactory
    // throw, which also suppresses plain autocomplete - a state a one-click
    // menu must never drop the user into.
    it("never sets NextEdit to 'on' from the menu", async () => {
      for (const current of ["auto", "off", "on"]) {
        const update = await pick("toggleNextEdit", {
          values: { "nextEdit.enabled": current },
        });
        const values = update.mock.calls.map((c) => c[1]);
        expect(values).not.toContain("on");
      }
    });
  });

  describe("configuration actions", () => {
    it("delegates the API key change to the existing command", async () => {
      await pick("changeApiKey");
      expect(executeCommand).toHaveBeenCalledWith(
        "runahead.setOpenRouterApiKey",
      );
    });

    it("saves a new model", async () => {
      showInputBox.mockResolvedValue("openai/gpt-oss-120b:free");
      const update = await pick("changeModel");
      expect(update).toHaveBeenCalledWith(
        "openRouter.model",
        "openai/gpt-oss-120b:free",
        1,
      );
    });

    it("does not write the model when the input box is dismissed", async () => {
      showInputBox.mockResolvedValue(undefined);
      const update = await pick("changeModel");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("reset settings", () => {
    it("clears every setting in both global and workspace scope once confirmed", async () => {
      showWarningMessage.mockResolvedValue("Reset Settings");
      const update = await pick("resetSettings");

      for (const key of [
        "enableTabAutocomplete",
        "openRouter.model",
        "nextEdit.enabled",
        "modelTimeout",
      ]) {
        expect(update).toHaveBeenCalledWith(key, undefined, 1 /* Global */);
        expect(update).toHaveBeenCalledWith(key, undefined, 2 /* Workspace */);
      }
    });

    it("leaves the stored API key untouched", async () => {
      showWarningMessage.mockResolvedValue("Reset Settings");
      const context = makeContext("sk-keep-me");
      mockConfig();
      showQuickPick.mockImplementation(async (items: any[]) =>
        items.find((i) => i.action === "resetSettings"),
      );

      await showStatusBarMenu(context, SECRET, DEFAULT_MODEL);

      // The menu has no route to the secret store beyond reading it.
      expect(context.secrets.delete).toBeUndefined();
      expect(context.secrets.store).toBeUndefined();
    });

    it("does nothing when the confirmation is dismissed", async () => {
      showWarningMessage.mockResolvedValue(undefined);
      const update = await pick("resetSettings");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("reset cache", () => {
    it("empties the cache table once confirmed", async () => {
      showWarningMessage.mockResolvedValue("Reset Cache");
      await pick("resetCache");

      expect(sqliteOpen).toHaveBeenCalled();
      expect(dbRun).toHaveBeenCalledWith("DELETE FROM cache");
      expect(dbClose).toHaveBeenCalled();
    });

    it("does nothing when the confirmation is dismissed", async () => {
      showWarningMessage.mockResolvedValue(undefined);
      await pick("resetCache");
      expect(sqliteOpen).not.toHaveBeenCalled();
    });

    it("warns rather than throwing when the cache cannot be opened", async () => {
      showWarningMessage.mockResolvedValue("Reset Cache");
      sqliteOpen.mockRejectedValueOnce(new Error("SQLITE_CANTOPEN"));

      await expect(pick("resetCache")).resolves.not.toThrow();
      expect(showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("could not clear"),
      );
    });
  });

  it("does nothing when the menu itself is dismissed", async () => {
    const update = mockConfig();
    showQuickPick.mockResolvedValue(undefined);

    await showStatusBarMenu(makeContext(), SECRET, DEFAULT_MODEL);

    expect(update).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
