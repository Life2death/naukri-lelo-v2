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

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower.includes("key") ||
      lower.includes("token")
    ) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function recordPromptCapture(entry: Omit<PromptCaptureEntry, "id" | "timestamp" | "tokenEstimate">): void {
  if (!isDebugCaptureEnabled()) return;

  const full: PromptCaptureEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
    tokenEstimate: estimateTokens(entry.enhancedSystemPrompt),
    segments: entry.segments,
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

export function instrumentCaptureParams(params: {
  source: "overlay" | "chat" | "audio";
  providerId: string;
  model: string;
  segments: PromptCaptureSegment[];
  enhancedSystemPrompt: string;
  messages: unknown[];
  headers: Record<string, string>;
}): void {
  if (!isDebugCaptureEnabled()) return;

  recordPromptCapture({
    source: params.source,
    providerId: params.providerId,
    model: params.model,
    segments: params.segments,
    enhancedSystemPrompt: params.enhancedSystemPrompt,
    messages: params.messages,
    usage: undefined,
  });
}

export { redactHeaders };
