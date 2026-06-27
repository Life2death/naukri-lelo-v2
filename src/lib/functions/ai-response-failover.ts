import { fetchAIResponse } from "./ai-response.function";
import type { FetchAIResponseParams } from "./ai-response.function";
import type { TYPE_PROVIDER } from "@/types";

export interface FailoverParams extends FetchAIResponseParams {
  /** Ordered list of providers to try before giving up. First entry is the primary. */
  failoverChain?: TYPE_PROVIDER[];
  /** When true, non-retryable errors (4xx) also advance the chain instead of surfacing. */
  alwaysFallOver?: boolean;
}

/**
 * Check whether a yielded error string or an Error indicates a retryable failure.
 * `fetchAIResponse` handles network & HTTP errors by yielding diagnostic strings.
 */
function isRetryableFailure(chunkOrError: string | Error): boolean {
  const msg = typeof chunkOrError === "string" ? chunkOrError.toLowerCase() : chunkOrError.message.toLowerCase();

  // Network-level failures — retryable
  if (msg.includes("network error")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("econnrefused")) return true;
  if (msg.includes("enotfound")) return true;
  if (msg.includes("timeout")) return true;

  // Retryable HTTP status codes (5xx, 429, 529)
  if (msg.includes("api request failed: 5")) return true;
  if (msg.includes("api request failed: 429")) return true;
  if (msg.includes("api request failed: 529")) return true;

  // Streaming errors
  if (msg.includes("streaming not supported")) return false; // Config issue, not retryable
  if (msg.includes("error reading stream")) return true;

  return false;
}

/** True if the string looks like an error message from fetchAIResponse (not actual content). */
function isErrorChunk(chunk: string): boolean {
  const lower = chunk.toLowerCase();
  return (
    lower.startsWith("network error") ||
    lower.startsWith("api request failed") ||
    lower.startsWith("streaming not supported") ||
    lower.startsWith("error reading stream") ||
    lower.startsWith("failed to parse")
  );
}

export async function* fetchAIResponseWithFailover(
  params: FailoverParams
): AsyncIterable<string> {
  const { failoverChain, alwaysFallOver, selectedProvider, ...rest } = params;

  const chain = failoverChain && failoverChain.length > 0
    ? failoverChain
    : rest.provider
      ? [rest.provider]
      : [];

  if (chain.length === 0) {
    yield* fetchAIResponse(params);
    return;
  }

  // Deduplicate chain so we never try the same provider twice
  const seen = new Set<string>();
  const dedupedChain = chain.filter((p) => {
    const id = p.id || "unknown";
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let lastError: Error | undefined;
  let hasYielded = false;

  for (const provider of dedupedChain) {
    // If any chunk was yielded by a previous provider, do NOT fail over
    if (hasYielded) {
      throw lastError || new Error("Stream error occurred after first token — mid-stream failover is not allowed");
    }

    // Check for user-initiated abort
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const attemptParams: FetchAIResponseParams = {
      ...rest,
      provider,
      selectedProvider: {
        provider: provider.id || "unknown",
        variables: selectedProvider?.variables || {},
      },
    };

    try {
      let yieldedContent = false;

      for await (const chunk of fetchAIResponse(attemptParams)) {
        if (yieldedContent) {
          // Already yielding content — pass through everything
          yield chunk;
          continue;
        }

        // First chunk — is it an error?
        if (isErrorChunk(chunk)) {
          if (isRetryableFailure(chunk) || alwaysFallOver) {
            lastError = new Error(chunk);
            break; // Advance to next provider
          }
          // Non-retryable error — surface to user
          yield chunk;
          return;
        }

        // First real content chunk
        yieldedContent = true;
        hasYielded = true;
        yield chunk;
      }

      if (yieldedContent) return;
      // No content yielded — will try next provider (if any)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // User-initiated abort — propagate immediately
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }

      // Re-throw non-retryable unless alwaysFallOver
      if (!isRetryableFailure(err) && !alwaysFallOver) {
        throw err;
      }
      // Retryable: continue to next provider
    }
  }

  if (lastError) {
    throw new Error(`All providers failed. Last error: ${lastError.message}`);
  }

  // If signal was aborted, surface that
  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  throw new Error("All providers in the failover chain produced no output.");
}
