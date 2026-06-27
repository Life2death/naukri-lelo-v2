import { describe, it, expect, beforeEach, vi } from "vitest";

// ── localStorage mock ─────────────────────────────────────────────────────────
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

import { safeLocalStorage } from "@/lib/storage/helper";

describe("safeLocalStorage", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("sets and gets a value", () => {
    safeLocalStorage.setItem("test-key", "hello");
    expect(safeLocalStorage.getItem("test-key")).toBe("hello");
  });

  it("returns null for a missing key", () => {
    expect(safeLocalStorage.getItem("does-not-exist")).toBeNull();
  });

  it("removes a key", () => {
    safeLocalStorage.setItem("rm-key", "value");
    safeLocalStorage.removeItem("rm-key");
    expect(safeLocalStorage.getItem("rm-key")).toBeNull();
  });

  it("overwrites existing value", () => {
    safeLocalStorage.setItem("overwrite", "first");
    safeLocalStorage.setItem("overwrite", "second");
    expect(safeLocalStorage.getItem("overwrite")).toBe("second");
  });
});

// ── getResponseSettings (Phase E — single source of truth) ─────────────────

import { getResponseSettings, setResponseSettings } from "@/lib/storage/response-settings.storage";
import { RESPONSE_LENGTHS, DEFAULT_RESPONSE_LENGTH } from "@/lib";

describe("getResponseSettings (E1 — single source of truth)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('defaults to "short" when unset (global default)', () => {
    const settings = getResponseSettings();
    expect(settings.responseLength).toBe("short");
    expect(settings.language).toBe("english");
    expect(settings.autoScroll).toBe(true);
  });

  it("stored value overrides the global default", () => {
    setResponseSettings({ responseLength: "medium", language: "english", autoScroll: true });
    const settings = getResponseSettings();
    expect(settings.responseLength).toBe("medium");
  });

  it("partial stored values use defaults for missing keys", () => {
    setResponseSettings({ responseLength: "medium", language: "english", autoScroll: true });
    const settings = getResponseSettings();
    expect(settings.responseLength).toBe("medium");
  });
});

// ── Phase F — Respone length tiers + per-request override ────────────────

describe("Phase F — RESPONSE_LENGTHS tiers", () => {
  it("has 4 tiers in order: auto, short, medium, long", () => {
    const ids = RESPONSE_LENGTHS.map((l) => l.id);
    expect(ids).toEqual(["auto", "short", "medium", "long"]);
  });

  it("includes a 'long' entry with a non-empty prompt", () => {
    const long = RESPONSE_LENGTHS.find((l) => l.id === "long");
    expect(long).toBeDefined();
    expect(long!.prompt.length).toBeGreaterThan(0);
    expect(long!.description.length).toBeGreaterThan(0);
  });

  it("DEFAULT_RESPONSE_LENGTH is still 'short'", () => {
    expect(DEFAULT_RESPONSE_LENGTH).toBe("short");
  });
});
