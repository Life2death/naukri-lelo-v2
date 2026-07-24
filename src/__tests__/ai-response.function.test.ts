import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAIResponse,
  buildEnhancedSystemPrompt,
  LENGTH_RULE_PRECEDENCE_CLAUSE,
} from "@/lib/functions/ai-response.function";
import type { TYPE_PROVIDER } from "@/types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@bany/curl-to-json", () => ({
  default: (curl: string) => {
    if (curl.includes("bad-curl:::")) throw new Error("bad syntax");
    return {
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
    };
  },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

// Mock the response-settings module (used inside ai-response.function.ts)
vi.mock("@/lib", async (importOriginal) => {
  const orig = await importOriginal<any>();
  return {
    ...orig,
    getResponseSettings: () => ({ responseLength: "medium", language: "en" }),
    RESPONSE_LENGTHS: [
      { id: "auto", title: "Auto", description: "", prompt: "Auto prompt." },
      { id: "medium", title: "Medium", description: "", prompt: "Medium prompt." },
    ],
    LANGUAGES: [{ id: "en", prompt: "" }],
  };
});

vi.mock("@/config/constants", () => ({
  STORAGE_KEYS: {
    DEBUG_CAPTURE: "debug_capture",
    PROMPT_CAPTURE_LAST: "prompt_capture_last",
    RESPONSE_SETTINGS: "response_settings",
    THEME: "theme",
    TRANSPARENCY: "transparency",
    SYSTEM_PROMPT: "system_prompt",
    SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
    SCREENSHOT_CONFIG: "screenshot_config",
    CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
    CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
    SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
    SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
    SYSTEM_AUDIO_CONTEXT: "system_audio_context",
    SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
    CUSTOMIZABLE: "customizable",
    NAUKRI_LELO_API_ENABLED: "naukri_lelo_api_enabled",
    SHORTCUTS: "shortcuts",
    AUTOSTART_INITIALIZED: "autostart_initialized",
    SELECTED_AUDIO_DEVICES: "selected_audio_devices",
    SUPPORTS_IMAGES: "supports_images",
    ACTIVE_PROFILE_ID: "active_profile_id",
    PROVIDER_VARIABLES: "curl_provider_variables",
    JOB_PROVIDER: "job_provider",
    JOB_HISTORY: "job_history",
    JOB_SEARCH_SKILLS: "job_search_skills",
    PROFILE_CONTEXT_SETTINGS: "profile_context_settings",
  },
  MARKDOWN_FORMATTING_INSTRUCTIONS: "",
  DEFAULT_SYSTEM_PROMPT: "",
  MAX_FILES: 6,
  PROVIDER_MODEL_SUGGESTIONS: {},
  DEFAULT_QUICK_ACTIONS: [],
  JOB_MAX_AGE_DAYS: 5,
  JOB_HISTORY_RETENTION_DAYS: 7,
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

const openAiProvider: TYPE_PROVIDER = {
  id: "openai",
  name: "OpenAI",
  curl: `curl -X POST "https://api.openai.com/v1/chat/completions" \
    -H "Authorization: Bearer {{API_KEY}}" \
    -H "Content-Type: application/json" \
    -d '{"model":"{{MODEL}}","messages":[{"role":"system","content":"{{SYSTEM_PROMPT}}"},{"role":"user","content":"{{TEXT}}"}],"stream":true}'`,
  responseContentPath: "choices[0].message.content",
  streaming: true,
};

// extractVariables returns lowercase keys (api_key, model) which the app
// stores and passes as lowercase; deepVariableReplacer uppercases them before
// substitution. Tests must use lowercase to match real app behaviour.
const selectedProvider = {
  provider: "openai",
  variables: { api_key: "sk-test", model: "gpt-4o" },
};

/** Build an SSE stream body from an array of content chunks */
function makeSseStream(chunks: string[], done = true): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = chunks.map((c) => {
    const payload = JSON.stringify({ choices: [{ delta: { content: c } }] });
    return `data: ${payload}\n\n`;
  });
  if (done) lines.push("data: [DONE]\n\n");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function mockStreamingResponse(chunks: string[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    body: makeSseStream(chunks),
  } as unknown as Response);
}

function mockNonStreamingResponse(content: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
    body: null,
  } as unknown as Response);
}

function mockErrorResponse(status: number, body = "Error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: body,
    text: async () => body,
  } as unknown as Response);
}

async function collectChunks(gen: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fetchAIResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Streaming mode ───────────────────────────────────────────────────────
  it("streams chunks from an SSE response", async () => {
    mockStreamingResponse(["Hello", " ", "world"]);
    const gen = fetchAIResponse({
      provider: openAiProvider,
      selectedProvider,
      userMessage: "Say hello",
    });
    const chunks = await collectChunks(gen);
    expect(chunks.join("")).toBe("Hello world");
  });

  it("handles [DONE] sentinel and stops streaming", async () => {
    mockStreamingResponse(["done"]);
    const chunks = await collectChunks(
      fetchAIResponse({ provider: openAiProvider, selectedProvider, userMessage: "test" })
    );
    expect(chunks).toEqual(["done"]);
  });

  it("skips empty delta chunks without error", async () => {
    const encoder = new TextEncoder();
    const emptyDelta = `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`;
    const realDelta = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(emptyDelta + realDelta));
        c.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body } as unknown as Response);
    const chunks = await collectChunks(
      fetchAIResponse({ provider: openAiProvider, selectedProvider, userMessage: "test" })
    );
    expect(chunks).toEqual(["hi"]);
  });

  // ── Non-streaming mode ───────────────────────────────────────────────────
  it("returns full content for non-streaming provider", async () => {
    const nonStreamProvider: TYPE_PROVIDER = { ...openAiProvider, streaming: false };
    mockNonStreamingResponse("non-stream response");
    const chunks = await collectChunks(
      fetchAIResponse({ provider: nonStreamProvider, selectedProvider, userMessage: "test" })
    );
    expect(chunks.join("")).toBe("non-stream response");
  });

  // ── Error handling ───────────────────────────────────────────────────────
  it("throws on missing provider", async () => {
    await expect(
      collectChunks(
        fetchAIResponse({ provider: undefined, selectedProvider, userMessage: "test" })
      )
    ).rejects.toThrow("Provider not provided");
  });

  it("throws on missing user message", async () => {
    await expect(
      collectChunks(
        fetchAIResponse({ provider: openAiProvider, selectedProvider, userMessage: "" })
      )
    ).rejects.toThrow("User message is required");
  });

  it("throws on missing required variables", async () => {
    const missingVarProvider: TYPE_PROVIDER = {
      ...openAiProvider,
      curl: `curl -H "Authorization: Bearer {{API_KEY}}" -d '{"org":"{{ORG_ID}}"}'`,
    };
    // selectedProvider only has api_key; org_id is missing
    await expect(
      collectChunks(
        fetchAIResponse({ provider: missingVarProvider, selectedProvider, userMessage: "hi" })
      )
    ).rejects.toThrow(/Missing required variable: org_id/i);
  });

  it("throws on invalid curl syntax", async () => {
    const badProvider: TYPE_PROVIDER = { ...openAiProvider, curl: "bad-curl:::" };
    await expect(
      collectChunks(
        fetchAIResponse({ provider: badProvider, selectedProvider, userMessage: "test" })
      )
    ).rejects.toThrow(/Failed to parse curl/i);
  });

  it("yields error string on HTTP error (non-streaming path)", async () => {
    mockErrorResponse(401, "Unauthorized");
    const chunks = await collectChunks(
      fetchAIResponse({ provider: openAiProvider, selectedProvider, userMessage: "test" })
    );
    expect(chunks.join("")).toMatch(/API request failed.*401/i);
  });

  // ── Abort signal ────────────────────────────────────────────────────────
  it("stops immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const chunks = await collectChunks(
      fetchAIResponse({
        provider: openAiProvider,
        selectedProvider,
        userMessage: "test",
        signal: controller.signal,
      })
    );
    expect(chunks).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Image support ───────────────────────────────────────────────────────
  it("throws when images provided but provider curl lacks {{IMAGE}}", async () => {
    // openAiProvider curl doesn't have {{IMAGE}}
    await expect(
      collectChunks(
        fetchAIResponse({
          provider: openAiProvider,
          selectedProvider,
          userMessage: "describe this",
          imagesBase64: ["base64imgdata"],
        })
      )
    ).rejects.toThrow(/does not support image input/i);
  });

  // ── History injection ───────────────────────────────────────────────────
  it("injects conversation history into the request", async () => {
    mockStreamingResponse(["sure"]);
    const history = [
      { role: "user" as const, content: "hi", timestamp: 0 },
      { role: "assistant" as const, content: "hello", timestamp: 1 },
    ];
    await collectChunks(
      fetchAIResponse({ provider: openAiProvider, selectedProvider, userMessage: "follow up", history })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const roles = body.messages.map((m: any) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });
});

// ── buildEnhancedSystemPrompt tests (Part A) ───────────────────────────────

describe("buildEnhancedSystemPrompt", () => {
  it("returns { text, segments } with correct shape", () => {
    const result = buildEnhancedSystemPrompt("You are a helpful assistant.");

    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("segments");
    expect(Array.isArray(result.segments)).toBe(true);

    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);

    // Each segment has name and text
    for (const seg of result.segments) {
      expect(seg).toHaveProperty("name");
      expect(seg).toHaveProperty("text");
      expect(typeof seg.name).toBe("string");
    }
  });

  it("includes baseSystemPrompt in the authoritative text", () => {
    const basePrompt = "You are a helpful assistant.";
    const result = buildEnhancedSystemPrompt(basePrompt);
    expect(result.text).toContain(basePrompt);
  });

  it("prepends incoming segments as display-only metadata without modifying text", () => {
    const incoming = [{ name: "profileContext", text: "Profile info here." }];
    const basePrompt = "Base system prompt.";
    const result = buildEnhancedSystemPrompt(basePrompt, incoming);

    // Incoming segments appear first in the segments list (display-only)
    expect(result.segments[0].name).toBe("profileContext");
    expect(result.segments[0].text).toBe("Profile info here.");

    // But text is built from baseSystemPrompt + appended rules only
    // incoming segments' text is already embedded in baseSystemPrompt
    expect(result.text).toContain(basePrompt);
  });

  it("returns segments even without a baseSystemPrompt", () => {
    const result = buildEnhancedSystemPrompt();
    expect(typeof result.text).toBe("string");
    expect(Array.isArray(result.segments)).toBe(true);
  });

  it("text is byte-identical to the old string output for same inputs", () => {
    // The authoritative text is: baseSystemPrompt + lengthRule + precedenceClause + language + markdown
    // With mock data: lengthRule="Medium prompt.", language omitted (en), MARKDOWN=""
    const withBase = buildEnhancedSystemPrompt("Hello");
    expect(withBase.text).toBe(
      `Hello Medium prompt. ${LENGTH_RULE_PRECEDENCE_CLAUSE} `
    );

    const withoutBase = buildEnhancedSystemPrompt();
    expect(withoutBase.text).toBe(
      `Medium prompt. ${LENGTH_RULE_PRECEDENCE_CLAUSE} `
    );
  });

  it("responseLengthOverride beats getResponseSettings (Phase F)", () => {
    // Mock returns medium; override auto should switch to auto's (empty) prompt
    const result = buildEnhancedSystemPrompt("Base", undefined, "auto");
    expect(result.text).toContain("Base");
    // lengthRule segment should use "auto"
    const lengthSeg = result.segments.find((s) => s.name === "lengthRule");
    expect(lengthSeg).toBeDefined();
  });

  it("no override uses stored setting (Phase F)", () => {
    const result = buildEnhancedSystemPrompt("Base");
    const lengthSeg = result.segments.find((s) => s.name === "lengthRule");
    expect(lengthSeg).toBeDefined();
  });
});
