import { describe, expect, it } from "vitest";
import { getTemplateForModel } from "./AutocompleteTemplate.js";

describe("getTemplateForModel provider-awareness", () => {
  // "gpt-4" has no OpenRouter-style vendor prefix and is known (via the
  // existing gpt|claude|granite3 substring branch) to resolve to the
  // chat-based hole-filler template - used below as a reference point since
  // that template isn't exported directly.
  const knownHoleFillerTemplate = getTemplateForModel("gpt-4");

  it("forces the hole-filler (chat) template for any OpenRouter model, regardless of vendor-prefixed substring matches", () => {
    // Without the fix, "qwen"+"coder" would match the FIM-template branch -
    // wrong for OpenRouter, which only exposes chat-completions.
    const result = getTemplateForModel(
      "qwen/qwen-2.5-coder-32b-instruct",
      "openrouter",
    );
    expect(result).toBe(knownHoleFillerTemplate);
  });

  it("forces the hole-filler template for OpenRouter even when the model substring would match codestral's FIM template", () => {
    const result = getTemplateForModel("mistralai/codestral-2501", "openrouter");
    expect(result).toBe(knownHoleFillerTemplate);
  });

  it("forces the hole-filler template for OpenRouter models with no recognized substring at all", () => {
    const result = getTemplateForModel(
      "meta-llama/llama-3.1-70b-instruct",
      "openrouter",
    );
    expect(result).toBe(knownHoleFillerTemplate);
  });

  it("leaves non-OpenRouter dispatch unchanged: the same model without providerName still gets the FIM template", () => {
    const withProvider = getTemplateForModel(
      "qwen-2.5-coder-32b-instruct",
      "openrouter",
    );
    const withoutProvider = getTemplateForModel("qwen-2.5-coder-32b-instruct");

    expect(withProvider).toBe(knownHoleFillerTemplate);
    expect(withoutProvider).not.toBe(knownHoleFillerTemplate);
  });

  it("omitting providerName entirely preserves existing behavior", () => {
    expect(getTemplateForModel("gpt-4")).toBe(knownHoleFillerTemplate);
    expect(getTemplateForModel("gpt-4", undefined)).toBe(
      knownHoleFillerTemplate,
    );
  });
});
