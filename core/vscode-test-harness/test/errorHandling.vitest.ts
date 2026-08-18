import { describe, expect, it, vi, beforeEach } from "vitest";

const { showErrorMessage, executeCommand } = vi.hoisted(() => ({
  showErrorMessage: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: { showErrorMessage },
  commands: { executeCommand },
}));

import { handleLLMError } from "../src/util/errorHandling";

describe("handleLLMError", () => {
  beforeEach(() => {
    showErrorMessage.mockReset();
    executeCommand.mockReset();
  });

  it("classifies a 401 as an invalid API key and offers to set it", async () => {
    showErrorMessage.mockResolvedValue("Set API Key");

    const handled = await handleLLMError({ status: 401, message: "Unauthorized" });

    expect(handled).toBe(true);
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("OpenRouter API key"),
      "Set API Key",
    );
    expect(executeCommand).toHaveBeenCalledWith(
      "runahead.setOpenRouterApiKey",
    );
  });

  it("does not run the Set API Key command if the user dismisses the 401 message", async () => {
    showErrorMessage.mockResolvedValue(undefined);

    await handleLLMError({ status: 401 });

    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("classifies a 429 as rate limiting", async () => {
    const handled = await handleLLMError({ status: 429 });
    expect(handled).toBe(true);
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("rate limit"),
    );
  });

  it("classifies a 402 as rate limiting / insufficient credits", async () => {
    const handled = await handleLLMError({ status: 402 });
    expect(handled).toBe(true);
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("credits"),
    );
  });

  it("classifies a 400 as an invalid/unavailable model", async () => {
    const handled = await handleLLMError({ status: 400 });
    expect(handled).toBe(true);
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("openRouter.model"),
    );
  });

  it("falls back to a generic status message for unrecognized status codes", async () => {
    const handled = await handleLLMError({ status: 500, message: "boom" });
    expect(handled).toBe(true);
    expect(showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("500"),
    );
  });

  it("returns false (defers to generic handling) for a plain Error with no status", async () => {
    const handled = await handleLLMError(new Error("plain failure"));
    expect(handled).toBe(false);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("returns false for a cancellation-style AbortError with no status", async () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    const handled = await handleLLMError(err);
    expect(handled).toBe(false);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("returns false for non-Error, non-status-coded values", async () => {
    expect(await handleLLMError("cancel")).toBe(false);
    expect(await handleLLMError(undefined)).toBe(false);
  });
});
