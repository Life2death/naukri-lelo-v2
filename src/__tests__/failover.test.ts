import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAIResponseWithFailover } from "@/lib/functions/ai-response-failover";
import type { TYPE_PROVIDER } from "@/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@bany/curl-to-json", () => ({
  default: (_curl: string) => ({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    header: { Authorization: "Bearer {{API_KEY}}" },
    data: {
      model: "{{MODEL}}",
      messages: [
        { role: "system", content: "{{SYSTEM_PROMPT}}" },
        { role: "user", content: "{{TEXT}}" },
      ],
      stream: false,
    },
  }),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

vi.mock("@/lib", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return {
    ...orig,
    getResponseSettings: () => ({ responseLength: "medium", language: "en" }),
    RESPONSE_LENGTHS: [{ id: "medium", prompt: "" }],
    LANGUAGES: [{ id: "en", prompt: "" }],
    MARKDOWN_FORMATTING_INSTRUCTIONS: "",
  };
});

vi.mock("@/config/constants", () => ({
  MARKDOWN_FORMATTING_INSTRUCTIONS: "",
  DEFAULT_SYSTEM_PROMPT: "",
  MAX_FILES: 6,
  STORAGE_KEYS: {},
  PROVIDER_MODEL_SUGGESTIONS: {},
  DEFAULT_QUICK_ACTIONS: [],
  JOB_MAX_AGE_DAYS: 5,
  JOB_HISTORY_RETENTION_DAYS: 7,
}));

vi.mock("@/lib/debug/prompt-capture", () => ({
  isDebugCaptureEnabled: () => false,
  recordPromptCapture: vi.fn(),
  getPromptCaptures: () => [],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const providerA: TYPE_PROVIDER = {
  id: "provider-a",
  curl: "curl https://api.a.com -H 'Auth: {{API_KEY}}' -d '{\"model\":\"{{MODEL}}\"}'",
  streaming: true,
  responseContentPath: "content",
};

const providerB: TYPE_PROVIDER = {
  id: "provider-b",
  curl: "curl https://api.b.com -H 'Auth: {{API_KEY}}' -d '{\"model\":\"{{MODEL}}\"}'",
  streaming: true,
  responseContentPath: "content",
};

const selectedProvider = {
  provider: "provider-a",
  variables: { api_key: "test-key", model: "test-model" },
};

function makeOkStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: c })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

function makeErrorResponse(status: number, body = "Error"): Response {
  return {
    ok: false,
    status,
    statusText: body,
    text: async () => body,
  } as unknown as Response;
}

async function collectChunks(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fetchAIResponseWithFailover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("yields content from the primary provider when it succeeds", async () => {
    mockFetch.mockResolvedValueOnce(makeOkStream(["hello"]));
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        userMessage: "hi",
      })
    );
    expect(chunks.join("")).toBe("hello");
  });

  it("falls over to the next provider on a retryable error before first token", async () => {
    // First call: network error
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    // Second call: success
    mockFetch.mockResolvedValueOnce(makeOkStream(["from b"]));

    const failoverChain = [providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
      })
    );
    expect(chunks.join("")).toBe("from b");
  });

  it("does not fail over once a chunk has been yielded", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"content\":\"partial\"}\n\n"));
        controller.close();
      },
    });
    // First provider yields a chunk but then errors (simulated via partial stream, then error)
    // A stream that yields content and then has an issue — we'll mock an ok stream that delivers a chunk
    mockFetch.mockResolvedValueOnce({ ok: true, body } as unknown as Response);

    // Second provider should never be called
    const failoverChain = [providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
      })
    );
    expect(chunks.join("")).toBe("partial");
    // fetch should have been called only once (for provider A)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws when all providers fail", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed"));

    const failoverChain = [providerA, providerB];
    await expect(
      collectChunks(
        fetchAIResponseWithFailover({
          provider: providerA,
          selectedProvider,
          failoverChain,
          userMessage: "hi",
        })
      )
    ).rejects.toThrow(/All providers failed/);
  });

  it("propagates non-retryable errors (400) without failing over", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, "Bad Request"));

    const failoverChain = [providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
      })
    );
    // 400 is not retryable — the API error string should be yielded
    expect(chunks.join("")).toMatch(/API request failed.*400/i);
    // Only provider A was contacted
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("advances on non-retryable (400) when alwaysFallOver is true", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(400, "Bad Request"));
    mockFetch.mockResolvedValueOnce(makeOkStream(["from b"]));

    const failoverChain = [providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
        alwaysFallOver: true,
      })
    );
    expect(chunks.join("")).toBe("from b");
  });

  it("falls over on 5xx error before first token", async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(503, "Service Unavailable"));
    mockFetch.mockResolvedValueOnce(makeOkStream(["from b"]));

    const failoverChain = [providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
      })
    );
    expect(chunks.join("")).toBe("from b");
  });

  it("skips duplicates in the failover chain", async () => {
    // Chain has A, A, B — should try A then B (skip duplicate A)
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    mockFetch.mockResolvedValueOnce(makeOkStream(["from b"]));

    const failoverChain = [providerA, providerA, providerB];
    const chunks = await collectChunks(
      fetchAIResponseWithFailover({
        provider: providerA,
        selectedProvider,
        failoverChain,
        userMessage: "hi",
      })
    );
    expect(chunks.join("")).toBe("from b");
    // fetch called twice (A then B, not A -> A -> B)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("re-throws user-initiated AbortError without failing over", async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      collectChunks(
        fetchAIResponseWithFailover({
          provider: providerA,
          selectedProvider,
          failoverChain: [providerA, providerB],
          userMessage: "hi",
          signal: abortController.signal,
        })
      )
    )      .rejects.toThrow(/Aborted/);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
