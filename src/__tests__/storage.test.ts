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
