import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// --- vscode mock -----------------------------------------------------------
// extension.ts's job is orchestration (config/secrets -> LLM -> provider
// registration + command wiring), not re-implementing CompletionProvider,
// NextEditWindowManager, JumpManager, or the status bar - those are already
// covered by core/vscode-test-harness's own tests. So we mock them out here
// and assert extension.ts wires them together correctly.

const { registerCommand, executeCommand } = vi.hoisted(() => ({
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
}));
const { registerInlineCompletionItemProvider } = vi.hoisted(() => ({
  registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
}));
const { showInputBox, showErrorMessage, showInformationMessage } = vi.hoisted(
  () => ({
    showInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(() => ({ then: vi.fn() })),
  }),
);
const { getConfiguration, onDidChangeConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, fallback?: unknown) => fallback),
    update: vi.fn(),
  })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("vscode", () => ({
  commands: { registerCommand, executeCommand },
  languages: { registerInlineCompletionItemProvider },
  window: { showInputBox, showErrorMessage, showInformationMessage },
  workspace: { getConfiguration, onDidChangeConfiguration },
  ConfigurationTarget: { Global: 1 },
}));

const { activateNextEdit } = vi.hoisted(() => ({
  activateNextEdit: vi.fn(),
}));
vi.mock(
  "core/vscode-test-harness/src/autocomplete/completionProvider",
  () => ({
    ContinueCompletionProvider: vi.fn().mockImplementation(() => ({
      activateNextEdit,
    })),
  }),
);

vi.mock("core/vscode-test-harness/src/activation/NextEditWindowManager", () => ({
  NextEditWindowManager: {
    getInstance: vi.fn(() => ({
      setupNextEditWindowManager: vi.fn(),
    })),
    clearInstance: vi.fn(),
  },
}));

vi.mock("core/vscode-test-harness/src/activation/JumpManager", () => ({
  JumpManager: { clearInstance: vi.fn() },
}));

const { setupStatusBar, initStatusBar } = vi.hoisted(() => ({
  setupStatusBar: vi.fn(),
  initStatusBar: vi.fn(() => ({ dispose: vi.fn() })),
}));
vi.mock("core/vscode-test-harness/src/autocomplete/statusBar", () => ({
  setupStatusBar,
  initStatusBar,
  StatusBarStatus: { Enabled: 1, Disabled: 0 },
}));

const { OpenRouterMock } = vi.hoisted(() => ({
  OpenRouterMock: vi.fn().mockImplementation((opts: any) => opts),
}));
vi.mock("core/llm/llms/OpenRouter", () => ({ OpenRouter: OpenRouterMock }));

// Mocked so the constructor args (notably the tabAutocompleteOptions override)
// can be asserted. `modelSupportsNextEdit` is deliberately NOT mocked - the
// real implementation is what the activation gating must agree with.
const { MinimalConfigProviderMock } = vi.hoisted(() => ({
  MinimalConfigProviderMock: vi.fn().mockImplementation((cfg: any) => cfg),
}));
vi.mock("core/autocomplete/MinimalConfig", () => ({
  MinimalConfigProvider: MinimalConfigProviderMock,
}));

import {
  activate,
  deactivate,
  OPENROUTER_API_KEY_SECRET,
  validateOpenRouterApiKey,
} from "../src/extension";
import { ContinueCompletionProvider } from "core/vscode-test-harness/src/autocomplete/completionProvider";

/** In-memory fake `vscode.SecretStorage` + minimal `ExtensionContext`. */
function makeFakeContext() {
  const store = new Map<string, string>();
  const changeListeners: Array<(e: { key: string }) => void> = [];
  const secrets = {
    get: vi.fn(async (key: string) => store.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      changeListeners.forEach((cb) => cb({ key }));
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    onDidChange: vi.fn((cb: (e: { key: string }) => void) => {
      changeListeners.push(cb);
      return { dispose: vi.fn() };
    }),
  };
  return {
    subscriptions: [] as { dispose(): void }[],
    secrets,
    __store: store,
  } as any;
}

describe("extension.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).fetch = vi.fn();
  });

  describe("validateOpenRouterApiKey", () => {
    it("returns true for a 2xx response", async () => {
      (global.fetch as any).mockResolvedValue({ status: 200, ok: true });
      await expect(validateOpenRouterApiKey("sk-good")).resolves.toBe(true);
    });

    it("returns false for a 401 response", async () => {
      (global.fetch as any).mockResolvedValue({ status: 401, ok: false });
      await expect(validateOpenRouterApiKey("sk-bad")).resolves.toBe(false);
    });

    it("throws for other non-ok statuses", async () => {
      (global.fetch as any).mockResolvedValue({ status: 500, ok: false });
      await expect(validateOpenRouterApiKey("sk-x")).rejects.toThrow("500");
    });
  });

  describe("activate() - no API key stored", () => {
    it("registers all expected commands even with no key", async () => {
      const context = makeFakeContext();
      await activate(context);

      const registeredIds = registerCommand.mock.calls.map((c) => c[0]);
      expect(registeredIds).toEqual(
        expect.arrayContaining([
          "continue.setOpenRouterApiKey",
          "continue.openTabAutocompleteConfigMenu",
          "continue.logAutocompleteOutcome",
          "continue.logNextEditOutcomeAccept",
          "continue.logNextEditOutcomeReject",
        ]),
      );
    });

    it("does not construct an OpenRouter LLM or register the inline completion provider", async () => {
      const context = makeFakeContext();
      await activate(context);

      expect(OpenRouterMock).not.toHaveBeenCalled();
      expect(registerInlineCompletionItemProvider).not.toHaveBeenCalled();
      expect(setupStatusBar).toHaveBeenCalledWith(0 /* Disabled */);
    });

    it("prompts the user to set an API key", async () => {
      const context = makeFakeContext();
      await activate(context);

      expect(showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("OpenRouter API key"),
        "Set API Key",
      );
    });
  });

  describe("activate() - API key already stored", () => {
    it("constructs the OpenRouter LLM with the stored key and configured model, and registers the completion provider", async () => {
      const context = makeFakeContext();
      await context.secrets.store(OPENROUTER_API_KEY_SECRET, "sk-existing");
      getConfiguration.mockReturnValue({
        get: vi.fn((key: string, fallback?: unknown) =>
          key === "openRouter.model" ? "qwen/qwen-2.5-coder-32b-instruct" : fallback,
        ),
        update: vi.fn(),
      });

      await activate(context);

      expect(OpenRouterMock).toHaveBeenCalledWith({
        apiKey: "sk-existing",
        model: "qwen/qwen-2.5-coder-32b-instruct",
      });
      expect(ContinueCompletionProvider).toHaveBeenCalled();
      expect(registerInlineCompletionItemProvider).toHaveBeenCalled();
      expect(setupStatusBar).toHaveBeenCalledWith(1 /* Enabled */);
    });

    it("raises modelTimeout above the upstream 150ms default, which truncates hosted-API completions to one line", async () => {
      const context = makeFakeContext();
      await context.secrets.store(OPENROUTER_API_KEY_SECRET, "sk-existing");
      getConfiguration.mockReturnValue({
        get: vi.fn((_key: string, fallback?: unknown) => fallback),
        update: vi.fn(),
      });

      await activate(context);

      const config = (MinimalConfigProviderMock as unknown as Mock).mock
        .calls[0][0];
      expect(config.tabAutocompleteOptions.modelTimeout).toBe(5000);
    });

    // The completion gate reads status bar state, not the setting, so
    // force-enabling here would silently undo the user's choice on reload.
    it("honours enableTabAutocomplete=false at startup instead of force-enabling", async () => {
      const context = makeFakeContext();
      await context.secrets.store(OPENROUTER_API_KEY_SECRET, "sk-existing");
      getConfiguration.mockReturnValue({
        get: vi.fn((key: string, fallback?: unknown) =>
          key === "enableTabAutocomplete" ? false : fallback,
        ),
        update: vi.fn(),
      });

      await activate(context);

      expect(setupStatusBar).toHaveBeenCalledWith(0 /* Disabled */);
      expect(setupStatusBar).not.toHaveBeenCalledWith(1 /* Enabled */);
    });

    it("enables the status bar when enableTabAutocomplete is true", async () => {
      const context = makeFakeContext();
      await context.secrets.store(OPENROUTER_API_KEY_SECRET, "sk-existing");
      getConfiguration.mockReturnValue({
        get: vi.fn((_key: string, fallback?: unknown) => fallback),
        update: vi.fn(),
      });

      await activate(context);

      expect(setupStatusBar).toHaveBeenCalledWith(1 /* Enabled */);
    });
  });

  // NextEdit only works with fine-tuned models - NextEditProviderFactory
  // throws for anything else. Activating it for a general chat model makes
  // NextEditProvider bail out, and because plain autocomplete sits in the
  // `else` branch of that check, nothing renders at all.
  describe("NextEdit activation gating", () => {
    async function activateWithModel(
      model: string,
      nextEditSetting = "auto",
    ) {
      const context = makeFakeContext();
      await context.secrets.store(OPENROUTER_API_KEY_SECRET, "sk-existing");
      getConfiguration.mockReturnValue({
        get: vi.fn((key: string, fallback?: unknown) => {
          if (key === "openRouter.model") return model;
          if (key === "nextEdit.enabled") return nextEditSetting;
          return fallback;
        }),
        update: vi.fn(),
      });
      await activate(context);
    }

    it("does NOT activate NextEdit for a general chat model", async () => {
      await activateWithModel("anthropic/claude-3.5-sonnet");
      expect(activateNextEdit).not.toHaveBeenCalled();
    });

    it("does NOT activate NextEdit for the free-tier default model", async () => {
      await activateWithModel("nvidia/nemotron-3-nano-30b-a3b:free");
      expect(activateNextEdit).not.toHaveBeenCalled();
    });

    it("activates NextEdit for a Mercury Coder model, including vendor-prefixed OpenRouter ids", async () => {
      await activateWithModel("inception/mercury-coder");
      expect(activateNextEdit).toHaveBeenCalled();
    });

    it("activates NextEdit for an Instinct model", async () => {
      await activateWithModel("some-vendor/instinct");
      expect(activateNextEdit).toHaveBeenCalled();
    });

    it("respects an explicit 'off' override even on a capable model", async () => {
      await activateWithModel("inception/mercury-coder", "off");
      expect(activateNextEdit).not.toHaveBeenCalled();
    });

    it("respects an explicit 'on' override on a model it wouldn't auto-detect", async () => {
      await activateWithModel("anthropic/claude-3.5-sonnet", "on");
      expect(activateNextEdit).toHaveBeenCalled();
    });
  });

  describe("setOpenRouterApiKey command", () => {
    function getHandler() {
      const call = registerCommand.mock.calls.find(
        (c) => c[0] === "continue.setOpenRouterApiKey",
      );
      if (!call) {
        throw new Error("continue.setOpenRouterApiKey was not registered");
      }
      return call[1] as () => Promise<void>;
    }

    it("validates and stores a good key", async () => {
      const context = makeFakeContext();
      await activate(context);
      showInputBox.mockResolvedValue("sk-good");
      (global.fetch as any).mockResolvedValue({ status: 200, ok: true });

      await getHandler()();

      expect(context.secrets.store).toHaveBeenCalledWith(
        OPENROUTER_API_KEY_SECRET,
        "sk-good",
      );
    });

    it("rejects and does not store an invalid key", async () => {
      const context = makeFakeContext();
      await activate(context);
      showInputBox.mockResolvedValue("sk-bad");
      (global.fetch as any).mockResolvedValue({ status: 401, ok: false });

      await getHandler()();

      expect(context.secrets.store).not.toHaveBeenCalledWith(
        OPENROUTER_API_KEY_SECRET,
        "sk-bad",
      );
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("rejected"),
      );
    });

    it("does nothing if the input box is dismissed", async () => {
      const context = makeFakeContext();
      await activate(context);
      showInputBox.mockResolvedValue(undefined);

      await getHandler()();

      expect(context.secrets.store).not.toHaveBeenCalled();
    });
  });

  describe("deactivate", () => {
    it("clears the JumpManager and NextEditWindowManager singletons without throwing", () => {
      expect(() => deactivate()).not.toThrow();
    });
  });
});
