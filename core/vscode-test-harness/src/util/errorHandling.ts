import * as vscode from "vscode";

/**
 * Duck-typed shape of the `openai` SDK's `APIError` (and subclasses like
 * `AuthenticationError`/`RateLimitError`/`BadRequestError`), which is what
 * `OpenRouter`'s adapter-routed requests throw on non-2xx HTTP responses
 * (see `core/llm/llms/OpenRouter.ts`). We duck-type rather than importing
 * the `openai` SDK's error classes here so this module stays independent of
 * that dependency.
 */
interface StatusCodedError {
  status?: number;
  message?: string;
}

function hasStatusCode(error: unknown): error is StatusCodedError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as StatusCodedError).status === "number"
  );
}

/**
 * Classifies a status-coded error (as thrown by the OpenRouter provider on
 * HTTP failure) into a user-facing message and optional action button.
 *
 * This assumes any status-coded error observed by the extension originates
 * from the (currently sole) configured LLM provider, OpenRouter - see
 * decision.md for the "single-provider extension" assumption this rests on.
 */
async function handleStatusCodedError(error: StatusCodedError): Promise<void> {
  switch (error.status) {
    case 401: {
      const action = await vscode.window.showErrorMessage(
        "Runahead: Your OpenRouter API key is missing or invalid.",
        "Set API Key",
      );
      if (action === "Set API Key") {
        await vscode.commands.executeCommand("runahead.setOpenRouterApiKey");
      }
      return;
    }
    case 402:
    case 429: {
      await vscode.window.showErrorMessage(
        "Runahead: OpenRouter rate limit reached or insufficient credits. Please wait and try again, or check your OpenRouter account balance.",
      );
      return;
    }
    case 400: {
      await vscode.window.showErrorMessage(
        `Runahead: OpenRouter rejected the request - the configured model may be invalid or unavailable. Check the "runahead.openRouter.model" setting.`,
      );
      return;
    }
    default: {
      await vscode.window.showErrorMessage(
        `Runahead: OpenRouter request failed (status ${error.status}).${
          error.message ? ` ${error.message}` : ""
        }`,
      );
      return;
    }
  }
}

/**
 * @param error Logs LLM errors for debugging purposes, and shows a
 * classified, actionable message for known OpenRouter failure modes.
 * @returns true if this function already showed an appropriate message and
 * the caller should skip its own generic error handling; false to allow
 * normal error handling flow.
 */
export async function handleLLMError(error: unknown): Promise<boolean> {
  if (hasStatusCode(error)) {
    await handleStatusCodedError(error);
    return true;
  }

  if (!error || !(error instanceof Error) || !error.message) {
    return false;
  }

  // Log errors for debugging but don't show interactive prompts
  const message = error.message;
  if (message.toLowerCase().includes("lemonade")) {
    console.log("Lemonade error:", message);
  } else if (message.toLowerCase().includes("ollama")) {
    console.log("Ollama error:", message);
  }

  // Always return false to allow normal error handling
  return false;
}
