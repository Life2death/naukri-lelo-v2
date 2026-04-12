import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock Tauri APIs that aren't available in the test environment
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(() =>
      Promise.resolve({
        execute: vi.fn(),
        select: vi.fn(() => Promise.resolve([])),
      })
    ),
  },
}));

// Mock FileReader for blobToBase64 tests
class MockFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsDataURL(_blob: Blob) {
    setTimeout(() => {
      this.result = `data:audio/wav;base64,SGVsbG9Xb3JsZA==`;
      this.onloadend?.();
    }, 0);
  }
}

Object.defineProperty(global, "FileReader", {
  writable: true,
  value: MockFileReader,
});
