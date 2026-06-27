import { describe, it, expect, vi, beforeEach } from "vitest";

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    get length() { return Object.keys(store).length; },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

import {
  isDebugCaptureEnabled,
  setDebugCaptureEnabled,
  recordPromptCapture,
  getPromptCaptures,
  clearPromptCaptures,
  subscribe,
} from "@/lib/debug/prompt-capture";
import { redactHeaders } from "@/lib/debug/prompt-capture";

describe("isDebugCaptureEnabled / setDebugCaptureEnabled", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("defaults to off", () => {
    expect(isDebugCaptureEnabled()).toBe(false);
  });

  it("returns true when set to true", () => {
    setDebugCaptureEnabled(true);
    expect(isDebugCaptureEnabled()).toBe(true);
  });

  it("returns false after disabling", () => {
    setDebugCaptureEnabled(true);
    setDebugCaptureEnabled(false);
    expect(isDebugCaptureEnabled()).toBe(false);
  });
});

describe("recordPromptCapture", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    clearPromptCaptures();
  });

  it("does not record when capture is disabled (no-op)", () => {
    setDebugCaptureEnabled(false);
    recordPromptCapture({
      source: "overlay",
      providerId: "openai",
      model: "gpt-4o",
      segments: [],
      enhancedSystemPrompt: "test prompt",
      messages: [],
      usage: undefined,
    });
    const captures = getPromptCaptures();
    expect(captures).toHaveLength(0);
  });

  it("records to ring buffer when enabled", () => {
    setDebugCaptureEnabled(true);
    recordPromptCapture({
      source: "overlay",
      providerId: "claude",
      model: "claude-sonnet-4-6",
      segments: [{ name: "base", text: "test" }],
      enhancedSystemPrompt: "test prompt",
      messages: [{ role: "user", content: "hi" }],
      usage: undefined,
    });
    const captures = getPromptCaptures();
    expect(captures).toHaveLength(1);
    expect(captures[0].providerId).toBe("claude");
    expect(captures[0].model).toBe("claude-sonnet-4-6");
    expect(captures[0].source).toBe("overlay");
    expect(captures[0].messages).toHaveLength(1);
  });

  it("records entries for chat and audio sources", () => {
    setDebugCaptureEnabled(true);
    recordPromptCapture({
      source: "chat",
      providerId: "openai",
      model: "gpt-4o",
      segments: [],
      enhancedSystemPrompt: "chat prompt",
      messages: [],
      usage: undefined,
    });
    recordPromptCapture({
      source: "audio",
      providerId: "groq",
      model: "llama-3.3-70b",
      segments: [],
      enhancedSystemPrompt: "audio prompt",
      messages: [],
      usage: undefined,
    });
    const captures = getPromptCaptures();
    expect(captures).toHaveLength(2);
    expect(captures[0].source).toBe("chat");
    expect(captures[1].source).toBe("audio");
  });

  it("persists the latest entry to localStorage", () => {
    setDebugCaptureEnabled(true);
    recordPromptCapture({
      source: "overlay",
      providerId: "openai",
      model: "gpt-4o",
      segments: [],
      enhancedSystemPrompt: "persisted prompt",
      messages: [],
      usage: undefined,
    });
    const stored = localStorageMock.getItem("prompt_capture_last");
    expect(stored).not.toBeNull();
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.enhancedSystemPrompt).toBe("persisted prompt");
    }
  });

  it("caps ring buffer at 20 entries", () => {
    setDebugCaptureEnabled(true);
    for (let i = 0; i < 25; i++) {
      recordPromptCapture({
        source: "overlay",
        providerId: "openai",
        model: "gpt-4o",
        segments: [],
        enhancedSystemPrompt: `prompt ${i}`,
        messages: [],
        usage: undefined,
      });
    }
    const captures = getPromptCaptures();
    expect(captures).toHaveLength(20);
    expect(captures[0].enhancedSystemPrompt).toBe("prompt 5");
  });
});

describe("redactHeaders", () => {
  it("redacts Authorization header", () => {
    const headers = { Authorization: "Bearer sk-test123" };
    const result = redactHeaders(headers);
    expect(result.Authorization).toBe("[REDACTED]");
  });

  it("redacts x-api-key header", () => {
    const headers = { "x-api-key": "sk-abc123" };
    const result = redactHeaders(headers);
    expect(result["x-api-key"]).toBe("[REDACTED]");
  });

  it("redacts any header containing 'key'", () => {
    const headers = { "X-Custom-Key": "some-value", "APIKEY": "value" };
    const result = redactHeaders(headers);
    expect(result["X-Custom-Key"]).toBe("[REDACTED]");
    expect(result["APIKEY"]).toBe("[REDACTED]");
  });

  it("redacts any header containing 'token'", () => {
    const headers = { "X-Auth-Token": "tok-123" };
    const result = redactHeaders(headers);
    expect(result["X-Auth-Token"]).toBe("[REDACTED]");
  });

  it("leaves other headers intact", () => {
    const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
    const result = redactHeaders(headers);
    expect(result["Content-Type"]).toBe("application/json");
    expect(result["anthropic-version"]).toBe("2023-06-01");
  });

  it("no raw key string appears anywhere in the serialized capture", () => {
    setDebugCaptureEnabled(true);
    const rawHeaders = { Authorization: "Bearer sk-test-abc" };
    const redacted = redactHeaders(rawHeaders);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("sk-test-abc");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).toContain("[REDACTED]");
  });
});

describe("subscribe", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    clearPromptCaptures();
  });

  it("calls listener when a new capture is recorded", () => {
    setDebugCaptureEnabled(true);
    const listener = vi.fn();
    const unsub = subscribe(listener);

    recordPromptCapture({
      source: "overlay",
      providerId: "openai",
      model: "gpt-4o",
      segments: [],
      enhancedSystemPrompt: "test",
      messages: [],
      usage: undefined,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("stops calling listener after unsubscribe", () => {
    setDebugCaptureEnabled(true);
    const listener = vi.fn();
    const unsub = subscribe(listener);
    unsub();

    recordPromptCapture({
      source: "overlay",
      providerId: "openai",
      model: "gpt-4o",
      segments: [],
      enhancedSystemPrompt: "test",
      messages: [],
      usage: undefined,
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
