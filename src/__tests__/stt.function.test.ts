import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSTT } from "@/lib/functions/stt.function";
import type { TYPE_PROVIDER } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────────────

// curl2Json: parse a fake curl for all valid provider curls
vi.mock("@bany/curl-to-json", () => ({
  default: (curl: string) => {
    if (curl.includes("bad-curl:::")) throw new Error("bad syntax");
    return {
      url: "https://api.openai.com/v1/audio/transcriptions",
      method: "POST",
      header: { Authorization: "Bearer {{API_KEY}}" },
      form: { model: "gpt-4o-transcribe", response_format: "text", language: "en" },
    };
  },
}));

// global fetch: return a successful transcription by default
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const openAiWhisperProvider: TYPE_PROVIDER = {
  id: "openai-whisper",
  name: "OpenAI Whisper",
  curl: `curl -X POST "https://api.openai.com/v1/audio/transcriptions" \
    -H "Authorization: Bearer {{API_KEY}}" \
    -F "file={{AUDIO}}" \
    -F "model=gpt-4o-transcribe" \
    -F "response_format=text" \
    -F "language=en"`,
  responseContentPath: "text",
  streaming: false,
};

const selectedProvider = {
  provider: "openai-whisper",
  variables: { API_KEY: "sk-test-key" },
};

function makeAudioBlob(content = "fake-wav-bytes", type = "audio/wav"): Blob {
  return new Blob([content], { type });
}

function mockSuccessResponse(body: Record<string, any> | string) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => text,
  } as unknown as Response);
}

function mockErrorResponse(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: "Error",
    text: async () => body,
  } as unknown as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fetchSTT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns transcription on a successful JSON response", async () => {
    mockSuccessResponse({ text: "hello world" });
    const audio = makeAudioBlob();
    const result = await fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio });
    expect(result).toBe("hello world");
  });

  it("returns plain text response when body is not JSON", async () => {
    mockSuccessResponse("hello world");
    const audio = makeAudioBlob();
    const result = await fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio });
    expect(result).toBe("hello world");
  });

  it("throws when provider is undefined", async () => {
    const audio = makeAudioBlob();
    await expect(
      fetchSTT({ provider: undefined, selectedProvider, audio })
    ).rejects.toThrow("Provider not provided");
  });

  it("throws when audio blob is empty (size 0)", async () => {
    const emptyBlob = new Blob([], { type: "audio/wav" });
    await expect(
      fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio: emptyBlob })
    ).rejects.toThrow("Audio file is empty");
  });

  it("throws on HTTP error response", async () => {
    mockErrorResponse(401, JSON.stringify({ message: "Unauthorized" }));
    const audio = makeAudioBlob();
    await expect(
      fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio })
    ).rejects.toThrow("HTTP 401");
  });

  it("throws on HTTP 429 rate limit error", async () => {
    mockErrorResponse(429, JSON.stringify({ message: "Rate limit exceeded" }));
    const audio = makeAudioBlob();
    await expect(
      fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio })
    ).rejects.toThrow("HTTP 429");
  });

  it("throws when curl command is invalid", async () => {
    const badProvider: TYPE_PROVIDER = {
      ...openAiWhisperProvider,
      curl: "bad-curl:::",
    };
    const audio = makeAudioBlob();
    await expect(
      fetchSTT({ provider: badProvider, selectedProvider, audio })
    ).rejects.toThrow("Failed to parse curl");
  });

  it("returns warning when transcription is empty in JSON", async () => {
    mockSuccessResponse({ text: "" });
    const audio = makeAudioBlob();
    const result = await fetchSTT({ provider: openAiWhisperProvider, selectedProvider, audio });
    expect(result).toContain("No transcription found");
  });

  it("extracts nested transcription via responseContentPath", async () => {
    const deepPathProvider: TYPE_PROVIDER = {
      ...openAiWhisperProvider,
      responseContentPath: "results[0].alternatives[0].transcript",
    };
    mockSuccessResponse({
      results: [{ alternatives: [{ transcript: "nested transcript" }] }],
    });
    const audio = makeAudioBlob();
    const result = await fetchSTT({ provider: deepPathProvider, selectedProvider, audio });
    expect(result).toBe("nested transcript");
  });
});
