import { fetchAIResponse } from "./ai-response.function";
import type { FetchAIResponseParams } from "./ai-response.function";
import type { TYPE_PROVIDER } from "@/types";

export interface FailoverChainEntry {
  provider: TYPE_PROVIDER;
  variables: Record<string, string>;
}

export interface FailoverParams extends FetchAIResponseParams {
  /** Ordered list of providers with their own variables to try before giving up. First entry is the primary. */
  failoverChain?: FailoverChainEntry[];
  /** When true, non-retryable errors (4xx) also advance the chain instead of surfacing. */
  alwaysFallOver?: boolean;
}

function isRetryableFailure(chunkOrError: string | Error): boolean {
  const msg = typeof chunkOrError === "string" ? chunkOrError.toLowerCase() : chunkOrError.message.toLowerCase();

  if (msg.includes("network error")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("econnrefused")) return true;
  if (msg.includes("enotfound")) return true;
  if (msg.includes("timeout")) return true;

  if (msg.includes("api request failed: 5")) return true;
  if (msg.includes("api request failed: 429")) return true;
  if (msg.includes("api request failed: 529")) return true;

  if (msg.includes("streaming not supported")) return false;
  if (msg.includes("error reading stream")) return true;

  return false;
}

// NOTE: the old `isErrorChunk` heuristic is gone. fetchAIResponse used to
// signal failures by yielding them as ordinary content, so this layer had to
// guess whether a chunk was an answer or an error by string-matching its
// prefix — which also meant any answer that happened to begin with e.g.
// "Network error..." was misread as a failure. Failures now arrive as thrown
// AIResponseErrors and are handled in the catch below.

export async function* fetchAIResponseWithFailover(
  params: FailoverParams
): AsyncIterable<string> {
  const { failoverChain, alwaysFallOver, selectedProvider, ...rest } = params;

  // Build the attempt chain: if failoverChain provided, use it; otherwise fall back to single-provider
  const chain = failoverChain && failoverChain.length > 0
    ? failoverChain
    : rest.provider
      ? [{ provider: rest.provider, variables: selectedProvider?.variables || {} }]
      : [];

  if (chain.length === 0) {
    yield* fetchAIResponse(params);
    return;
  }

  // Deduplicate by provider id
  const seen = new Set<string>();
  const dedupedChain = chain.filter((entry) => {
    const id = entry.provider.id || "unknown";
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let lastError: Error | undefined;
  let hasYielded = false;

  for (const entry of dedupedChain) {
    if (hasYielded) {
      throw lastError || new Error("Stream error occurred after first token — mid-stream failover is not allowed");
    }

    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const attemptParams: FetchAIResponseParams = {
      ...rest,
      provider: entry.provider,
      selectedProvider: {
        provider: entry.provider.id || "unknown",
        variables: entry.variables,
      },
    };

    try {
      for await (const chunk of fetchAIResponse(attemptParams)) {
        hasYielded = true;
        yield chunk;
      }

      // The attempt completed without throwing, so it succeeded — return even
      // if it produced no tokens. Falling through on an empty-but-successful
      // completion made a second, billed request to the next provider for an
      // answer the first one had legitimately declined to give.
      return;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }

      if (!isRetryableFailure(err) && !alwaysFallOver) {
        throw err;
      }
    }
  }

  if (lastError) {
    throw new Error(`All providers failed. Last error: ${lastError.message}`);
  }

  if (params.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  throw new Error("All providers in the failover chain produced no output.");
}
