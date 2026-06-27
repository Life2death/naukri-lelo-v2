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
  notifyUsageUpdate,
} from "@/lib/debug/prompt-capture";


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

describe("stripImageData (via recordPromptCapture)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    clearPromptCaptures();
  });

  it("elides base64 image data in stored messages", () => {
    setDebugCaptureEnabled(true);
    // Build a >200-char fake base64 string to trigger the elision check
    const longBase64 = "iVBORw0KGgo" + "A".repeat(250);
    recordPromptCapture({
      source: "overlay",
      providerId: "test",
      model: "test-model",
      segments: [],
      enhancedSystemPrompt: "test",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image_url", image_url: { url: "data:image/png;base64," + longBase64 } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: longBase64 } },
          ],
        },
      ],
    });
    const captures = getPromptCaptures();
    expect(captures).toHaveLength(1);
    const msg = captures[0].messages[0] as any;
    const imageUrlContent = msg.content[1].image_url.url;
    const imageSourceData = msg.content[2].source.data;
    expect(imageUrlContent).toContain("[elided]");
    expect(imageUrlContent).not.toContain(longBase64.slice(0, 20));
    expect(imageSourceData).toMatch(/\[elided/);
    expect(imageSourceData).not.toContain(longBase64.slice(0, 20));
  });
});

describe("notifyUsageUpdate", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    clearPromptCaptures();
  });

  it("notifies subscribers when usage is updated", () => {
    setDebugCaptureEnabled(true);
    const listener = vi.fn();
    subscribe(listener);
    const entry = {
      id: "test-id",
      timestamp: Date.now(),
      source: "overlay" as const,
      providerId: "test",
      model: "test-model",
      segments: [] as any[],
      enhancedSystemPrompt: "test",
      messages: [],
      tokenEstimate: 5,
      usage: { cache_read_input_tokens: 100 },
    };

    notifyUsageUpdate(entry);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(entry);
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
