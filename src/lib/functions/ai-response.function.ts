import {
  buildDynamicMessages,
  deepVariableReplacer,
  extractVariables,
  getByPath,
  getStreamingContent,
} from "./common.function";
import { Message, TYPE_PROVIDER } from "@/types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import curl2Json from "@bany/curl-to-json";
import { getResponseSettings, RESPONSE_LENGTHS, LANGUAGES, DEFAULT_LANGUAGE } from "@/lib";
import { MARKDOWN_FORMATTING_INSTRUCTIONS, STORAGE_KEYS } from "@/config/constants";
import {
  isDebugCaptureEnabled,
  recordPromptCapture,
} from "@/lib/debug/prompt-capture";

export interface PromptSegment {
  name: string;
  text: string;
}

export function buildEnhancedSystemPrompt(
  baseSystemPrompt?: string,
  incomingSegments?: PromptSegment[],
  source?: "overlay" | "chat" | "audio"
): { text: string; segments: PromptSegment[] } {
  const responseSettings = getResponseSettings(source);
  const prompts: string[] = [];

  if (baseSystemPrompt) {
    prompts.push(baseSystemPrompt);
  }

  const lengthOption = RESPONSE_LENGTHS.find(
    (l) => l.id === responseSettings.responseLength
  );
  if (lengthOption?.prompt?.trim()) {
    prompts.push(lengthOption.prompt);
  }

  // Skip language segment when english — the model defaults to english anyway
  const languageOption = LANGUAGES.find(
    (l) => l.id === responseSettings.language
  );
  if (languageOption?.prompt?.trim() && responseSettings.language !== DEFAULT_LANGUAGE) {
    prompts.push(languageOption.prompt);
  }

  // Add markdown formatting instructions
  prompts.push(MARKDOWN_FORMATTING_INSTRUCTIONS);

  const text = prompts.join(" ");

  const segments: PromptSegment[] = [...(incomingSegments || [])];
  if (lengthOption?.prompt?.trim()) {
    segments.push({ name: "lengthRule", text: lengthOption.prompt });
  }
  if (languageOption?.prompt?.trim() && responseSettings.language !== DEFAULT_LANGUAGE) {
    segments.push({ name: "language", text: languageOption.prompt });
  }
  segments.push({ name: "markdown", text: MARKDOWN_FORMATTING_INSTRUCTIONS });

  return { text, segments };
}


export type PromptCaptureSource = "overlay" | "chat" | "audio";

export interface FetchAIResponseParams {
  provider: TYPE_PROVIDER | undefined;
  selectedProvider: {
    provider: string;
    variables: Record<string, string>;
  };
  systemPrompt?: string;
  segments?: PromptSegment[];
  history?: Message[];
  userMessage: string;
  imagesBase64?: string[];
  signal?: AbortSignal;
  /** Used for prompt-capture source attribution. Only meaningful when DEBUG_CAPTURE is enabled. */
  _source?: PromptCaptureSource;
}

export async function* fetchAIResponse(
  params: FetchAIResponseParams
): AsyncIterable<string> {
  try {
    const {
      provider,
      selectedProvider,
      systemPrompt,
      segments: incomingSegments,
      history = [],
      userMessage,
      imagesBase64 = [],
      signal,
    } = params;

    // Check if already aborted
    if (signal?.aborted) {
      return;
    }

    const { text: enhancedSystemPrompt, segments: promptSegments } =
      buildEnhancedSystemPrompt(systemPrompt, incomingSegments, params._source);

    if (!provider) {
      throw new Error(`Provider not provided`);
    }
    if (!selectedProvider) {
      throw new Error(`Selected provider not provided`);
    }

    let curlJson;
    try {
      curlJson = curl2Json(provider.curl);
    } catch (error) {
      throw new Error(
        `Failed to parse curl: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    const extractedVariables = extractVariables(provider.curl);
    const requiredVars = extractedVariables.filter(
      ({ key }) => key !== "SYSTEM_PROMPT" && key !== "TEXT" && key !== "IMAGE"
    );
    for (const { key } of requiredVars) {
      if (
        !selectedProvider.variables?.[key] ||
        selectedProvider.variables[key].trim() === ""
      ) {
        throw new Error(
          `Missing required variable: ${key}. Please configure it in settings.`
        );
      }
    }

    if (!userMessage) {
      throw new Error("User message is required");
    }
    if (imagesBase64.length > 0 && !provider.curl.includes("{{IMAGE}}")) {
      throw new Error(
        `Provider ${provider?.id ?? "unknown"} does not support image input`
      );
    }

    let bodyObj: any = curlJson.data
      ? JSON.parse(JSON.stringify(curlJson.data))
      : {};
    const messagesKey = Object.keys(bodyObj).find((key) =>
      ["messages", "contents", "conversation", "history"].includes(key)
    );

    if (messagesKey && Array.isArray(bodyObj[messagesKey])) {
      const finalMessages = buildDynamicMessages(
        bodyObj[messagesKey],
        history,
        userMessage,
        imagesBase64
      );
      bodyObj[messagesKey] = finalMessages;
    }

    const allVariables = {
      ...Object.fromEntries(
        Object.entries(selectedProvider.variables).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ])
      ),
      SYSTEM_PROMPT: enhancedSystemPrompt || "",
    };

    bodyObj = deepVariableReplacer(bodyObj, allVariables);
    let url = deepVariableReplacer(curlJson.url || "", allVariables);

    const headers = deepVariableReplacer(curlJson.header || {}, allVariables);
    headers["Content-Type"] = "application/json";

    // Capture instrumentation (only when DEBUG_CAPTURE is on)
    if (isDebugCaptureEnabled() && provider) {
      const source = params._source || "chat";
      const model: string =
        (bodyObj?.model as string) || selectedProvider.variables?.model || "unknown";
      recordPromptCapture({
        source,
        providerId: provider.id || "unknown",
        model,
        segments: promptSegments,
        enhancedSystemPrompt,
        messages:
          bodyObj?.[
            Object.keys(bodyObj).find((k) =>
              ["messages", "contents", "conversation", "history"].includes(k)
            ) || ""
          ] || [],
        usage: undefined,
      });
    }

    if (provider?.streaming) {
      if (typeof bodyObj === "object" && bodyObj !== null) {
        const streamKey = Object.keys(bodyObj).find(
          (k) => k.toLowerCase() === "stream"
        );
        if (streamKey) {
          bodyObj[streamKey] = true;
        } else {
          bodyObj.stream = true;
        }
      }
    }

    const fetchFunction = url?.includes("http") ? fetch : tauriFetch;

    let response;
    try {
      response = await fetchFunction(url, {
        method: curlJson.method || "POST",
        headers,
        body: curlJson.method === "GET" ? undefined : JSON.stringify(bodyObj),
        signal,
      });
    } catch (fetchError) {
      // Check if aborted
      if (
        signal?.aborted ||
        (fetchError instanceof Error && fetchError.name === "AbortError")
      ) {
        return; // Silently return on abort
      }
      yield `Network error during API request: ${
        fetchError instanceof Error ? fetchError.message : "Unknown error"
      }`;
      return;
    }

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      yield `API request failed: ${response.status} ${response.statusText}${
        errorText ? ` - ${errorText}` : ""
      }`;
      return;
    }

    if (!provider?.streaming) {
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        yield `Failed to parse non-streaming response: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`;
        return;
      }
      const content =
        getByPath(json, provider?.responseContentPath || "") || "";
      yield content;
      return;
    }

    if (!response.body) {
      yield "Streaming not supported or response body missing";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let capturedUsage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    } | undefined;

    while (true) {
      // Check if aborted
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        // Check if aborted
        if (
          signal?.aborted ||
          (readError instanceof Error && readError.name === "AbortError")
        ) {
          return; // Silently return on abort
        }
        yield `Error reading stream: ${
          readError instanceof Error ? readError.message : "Unknown error"
        }`;
        return;
      }
      const { done, value } = readResult;
      if (done) break;

      // Check if aborted before processing
      if (signal?.aborted) {
        reader.cancel();
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const trimmed = line.substring(5).trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed);
            // Parse usage from streaming chunks
            if (parsed.type === "message_start" && parsed.message?.usage) {
              capturedUsage = {
                ...capturedUsage,
                ...parsed.message.usage,
              };
            }
            if (parsed.type === "message_delta" && parsed.usage) {
              capturedUsage = {
                ...capturedUsage,
                ...parsed.usage,
              };
            }
            if (parsed.usage && !parsed.type) {
              capturedUsage = {
                ...capturedUsage,
                ...parsed.usage,
              };
            }
            const delta = getStreamingContent(
              parsed,
              provider?.responseContentPath || ""
            );
            if (delta) {
              yield delta;
            }
          } catch (e) {
            // Ignore parsing errors for partial JSON chunks
          }
        }
      }
    }

    // Update capture with real usage if available
    if (isDebugCaptureEnabled() && capturedUsage) {
      const promptCapture = await import("@/lib/debug/prompt-capture");
      const captures = promptCapture.getPromptCaptures();
      const latest = captures[captures.length - 1];
      if (latest && !latest.usage) {
        latest.usage = capturedUsage;
        // Re-write localStorage so the Dev Space inspector (separate webview) sees cache tokens
        try {
          localStorage.setItem(
            STORAGE_KEYS.PROMPT_CAPTURE_LAST,
            JSON.stringify(latest)
          );
        } catch {
          // localStorage quota or other storage error
        }
        // Notify same-window subscribers
        promptCapture.notifyUsageUpdate(latest);
      }
    }
  } catch (error) {
    throw new Error(
      `Error in fetchAIResponse: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
