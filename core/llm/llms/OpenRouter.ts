import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { renderChatMessage } from "../../util/messageContent.js";
import { BaseLLM } from "../index.js";
import {
  fromChatCompletionChunk,
  LlmApiRequestType,
  toChatBody,
} from "../openaiTypeConverters.js";

/**
 * LLM provider for OpenRouter (https://openrouter.ai), a unified router that
 * exposes many upstream models behind a single OpenAI-compatible
 * chat-completions endpoint.
 *
 * Unlike `OpenAI`, this class deliberately does NOT extend `OpenAI`: several
 * call sites (`CompletionProvider`, `NextEditProvider`) special-case
 * `instanceof OpenAI` to flip on `useLegacyCompletionsEndpoint`, which routes
 * requests at the raw `completions` endpoint. OpenRouter has no such
 * endpoint (nor a `fim/completions` endpoint) - it only ever speaks
 * chat-completions - so this class extends `BaseLLM` directly and only ever
 * routes through the adapter's chat-completion methods.
 */
export class OpenRouter extends BaseLLM {
  static providerName = "openrouter";

  constructor(options: LLMOptions) {
    super({
      apiBase: "https://openrouter.ai/api/v1/",
      ...options,
    });
    // Ensure streamChat/streamComplete route through the OpenAI-compatible
    // adapter (see below) rather than any templated prompt string - leaving
    // this undefined is required for that routing to kick in.
    this.templateMessages = undefined;
  }

  // OpenRouter only exposes a chat-completions endpoint. No FIM
  // (`fim/completions`), no legacy completions endpoint, and no rerank
  // endpoint, so only "chat"/"streamChat" are adapter-routed.
  protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = [
    "chat",
    "streamChat",
  ];

  // Inherit BaseLLM.supportsFim() === false: OpenRouter has no FIM endpoint,
  // so autocomplete falls back to streamComplete(..., { raw: true }) below.

  /**
   * Autocomplete's non-FIM fallback path (`CompletionStreamer` calls
   * `llm.streamComplete(prompt, signal, { raw: true, ... })` when
   * `supportsFim()` is false). Sends the raw hole-filler prompt built by the
   * provider-aware autocomplete template (see
   * `AutocompleteTemplate.getTemplateForModel`) as a single user message to
   * OpenRouter's chat-completions endpoint via the adapter directly.
   *
   * This intentionally calls `this.openaiAdapter` rather than the public
   * `this.streamChat(...)`: the public method is already invoked (and
   * logged/token-counted once) by the outer `streamComplete()` call that
   * dispatches into this method, so re-entering it here would double-log the
   * interaction and double-count token usage.
   */
  protected async *_streamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    if (!this.openaiAdapter) {
      throw new Error("OpenRouter adapter failed to initialize");
    }

    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const body = this.modifyChatBody(toChatBody(messages, options));

    for await (const chunk of this.openaiAdapter.chatCompletionStream(
      { ...body, stream: true },
      signal,
    )) {
      const result = fromChatCompletionChunk(chunk);
      if (result) {
        yield renderChatMessage(result);
      }
    }
  }
}
