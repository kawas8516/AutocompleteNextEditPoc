import { describe, expect, it } from "vitest";
import { ChatCompletionChunk } from "openai/resources/index";

import { BaseLlmApi } from "../openai-adapters/apis/base.js";
import { chatChunk } from "../openai-adapters/util.js";
import { OpenRouter } from "./OpenRouter.js";

/** Minimal fake `BaseLlmApi` standing in for a real HTTP-backed adapter. */
function makeFakeAdapter(
  overrides: Partial<BaseLlmApi> = {},
): BaseLlmApi {
  return {
    chatCompletionNonStream: async () => {
      throw new Error("not implemented in fake");
    },
    async *chatCompletionStream(): AsyncGenerator<ChatCompletionChunk> {
      yield chatChunk({ content: "hello ", model: "test" });
      yield chatChunk({ content: "world", model: "test" });
    },
    completionNonStream: async () => {
      throw new Error("OpenRouter should never call completionNonStream");
    },
    async *completionStream(): AsyncGenerator<any> {
      throw new Error("OpenRouter should never call completionStream");
    },
    async *fimStream(): AsyncGenerator<ChatCompletionChunk> {
      throw new Error("OpenRouter should never call fimStream");
    },
    rerank: async () => {
      throw new Error("OpenRouter should never call rerank");
    },
    list: async () => [],
    ...overrides,
  };
}

describe("OpenRouter", () => {
  it("sets providerName and default apiBase", () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    expect(llm.providerName).toBe("openrouter");
    expect(llm.apiBase).toBe("https://openrouter.ai/api/v1/");
  });

  it("respects a custom apiBase", () => {
    const llm = new OpenRouter({
      apiKey: "test-key",
      model: "test-model",
      apiBase: "https://custom.example.com/v1",
    });
    expect(llm.apiBase).toBe("https://custom.example.com/v1/");
  });

  it("does not support FIM (OpenRouter has no FIM endpoint)", () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    expect(llm.supportsFim()).toBe(false);
  });

  it("only adapter-routes chat/streamChat, never streamFim/streamComplete/rerank", async () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    // useOpenAIAdapterFor is protected; assert via behavior instead of reflection
    // by checking that _streamFim (inherited default) throws "Not implemented".
    await expect(async () => {
      const gen = (llm as any)._streamFim("", "", new AbortController().signal, {
        model: "test-model",
      });
      await gen.next();
    }).rejects.toThrow("Not implemented");
  });

  it("streamComplete (raw hole-filler path) delegates to the adapter's chat-completion stream", async () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    (llm as any).openaiAdapter = makeFakeAdapter();

    const chunks: string[] = [];
    for await (const chunk of llm.streamComplete(
      "fill in the hole",
      new AbortController().signal,
      { raw: true, log: false },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("hello world");
  });

  it("propagates adapter errors (e.g. 401) out of streamComplete", async () => {
    const llm = new OpenRouter({ apiKey: "bad-key", model: "test-model" });
    (llm as any).openaiAdapter = makeFakeAdapter({
      async *chatCompletionStream(): AsyncGenerator<ChatCompletionChunk> {
        const err: any = new Error("Unauthorized");
        err.status = 401;
        throw err;
      },
    });

    await expect(async () => {
      for await (const _ of llm.streamComplete(
        "fill in the hole",
        new AbortController().signal,
        { raw: true, log: false },
      )) {
        // drain
      }
    }).rejects.toMatchObject({ status: 401 });
  });

  it("chat() (used by NextEdit) delegates to the adapter's chat-completion stream", async () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    (llm as any).openaiAdapter = makeFakeAdapter();

    const result = await llm.chat(
      [{ role: "user", content: "hi" }],
      new AbortController().signal,
      { log: false },
    );

    expect(result.content).toBe("hello world");
  });

  it("respects cancellation via AbortSignal", async () => {
    const llm = new OpenRouter({ apiKey: "test-key", model: "test-model" });
    const controller = new AbortController();
    (llm as any).openaiAdapter = makeFakeAdapter({
      async *chatCompletionStream(): AsyncGenerator<ChatCompletionChunk> {
        yield chatChunk({ content: "partial ", model: "test" });
        controller.abort();
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      },
    });

    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of llm.streamComplete(
        "fill in the hole",
        controller.signal,
        { raw: true, log: false },
      )) {
        chunks.push(chunk);
      }
    }).rejects.toThrow(/aborted/i);
    expect(chunks).toEqual(["partial "]);
  });
});
