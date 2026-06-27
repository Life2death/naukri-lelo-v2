import { estimateTokens } from "./token-estimate";
import { STORAGE_KEYS } from "@/config/constants";

export interface PromptCaptureSegment {
  name: string;
  text: string;
}

export interface PromptCaptureUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface PromptCaptureEntry {
  id: string;
  timestamp: number;
  source: "overlay" | "chat" | "audio";
  providerId: string;
  model: string;
  segments: PromptCaptureSegment[];
  enhancedSystemPrompt: string;
  messages: unknown[];
  tokenEstimate: number;
  usage?: PromptCaptureUsage;
}

type Listener = (entry: PromptCaptureEntry) => void;

const MAX_ENTRIES = 20;
let ringBuffer: PromptCaptureEntry[] = [];
const listeners = new Set<Listener>();

export function isDebugCaptureEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.DEBUG_CAPTURE) === "true";
  } catch {
    return false;
  }
}

export function setDebugCaptureEnabled(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(STORAGE_KEYS.DEBUG_CAPTURE, "true");
    } else {
      localStorage.removeItem(STORAGE_KEYS.DEBUG_CAPTURE);
    }
  } catch {
    // ignore storage errors
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Strip large base64 image data from stored messages so captures don't blow localStorage.
 * Elides `data:image/...` URLs and any string values > 200 chars that look like base64.
 */
function stripImageData(messages: unknown[]): unknown[] {
  return JSON.parse(
    JSON.stringify(messages),
    (_key: string, value: unknown) => {
      if (typeof value === "string" && value.startsWith("data:image/")) {
        const comma = value.indexOf(",");
        return comma > 0 ? value.slice(0, comma + 1) + "[elided]" : value;
      }
      if (typeof value === "string" && value.length > 200 && /^[A-Za-z0-9+/=]+$/.test(value)) {
        return "[elided base64]";
      }
      return value;
    }
  );
}

export function recordPromptCapture(entry: Omit<PromptCaptureEntry, "id" | "timestamp" | "tokenEstimate">): void {
  if (!isDebugCaptureEnabled()) return;

  const full: PromptCaptureEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
    tokenEstimate: estimateTokens(entry.enhancedSystemPrompt),
    segments: entry.segments,
    messages: stripImageData(entry.messages),
  };

  ringBuffer.push(full);
  if (ringBuffer.length > MAX_ENTRIES) {
    ringBuffer = ringBuffer.slice(-MAX_ENTRIES);
  }

  try {
    localStorage.setItem(STORAGE_KEYS.PROMPT_CAPTURE_LAST, JSON.stringify(full));
  } catch {
    // ignore storage errors
  }

  for (const cb of listeners) {
    try { cb(full); } catch { /* ignore listener errors */ }
  }
}

export function notifyUsageUpdate(entry: PromptCaptureEntry): void {
  for (const cb of listeners) {
    try { cb(entry); } catch { /* ignore listener errors */ }
  }
}

export function getPromptCaptures(): PromptCaptureEntry[] {
  return [...ringBuffer];
}

export function clearPromptCaptures(): void {
  ringBuffer = [];
}

export function getLastPromptCapture(): PromptCaptureEntry | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PROMPT_CAPTURE_LAST);
    if (!stored) return null;
    return JSON.parse(stored) as PromptCaptureEntry;
  } catch {
    return null;
  }
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}


