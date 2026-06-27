import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components";
import { BugIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import {
  isDebugCaptureEnabled,
  setDebugCaptureEnabled,
  getPromptCaptures,
  getLastPromptCapture,
  subscribe,
  type PromptCaptureEntry,
} from "@/lib/debug/prompt-capture";
import { estimateTokens } from "@/lib/debug/token-estimate";

function SegmentBar({ label, chars, totalChars }: { label: string; chars: number; totalChars: number }) {
  const pct = totalChars > 0 ? (chars / totalChars) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0 text-right text-muted-foreground font-mono">{label}</span>
      <div className="flex-1 h-3 rounded-sm bg-muted/50 overflow-hidden">
        <div
          className="h-full rounded-sm bg-primary/40"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-left font-mono text-muted-foreground">
        {chars}c / {Math.ceil(chars / 4)}tok
      </span>
    </div>
  );
}

function CaptureDetail({ capture }: { capture: PromptCaptureEntry }) {
  const totalChars = capture.enhancedSystemPrompt.length;
  return (
    <div className="space-y-2 pt-2">
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted-foreground">
        <div><span className="text-foreground">Provider:</span> {capture.providerId}</div>
        <div><span className="text-foreground">Model:</span> {capture.model}</div>
        <div><span className="text-foreground">Source:</span> {capture.source}</div>
        <div><span className="text-foreground">Messages:</span> {capture.messages.length}</div>
      </div>
      <div className="space-y-1 pt-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Segments</p>
        {capture.segments.map((seg, i) => (
          <SegmentBar key={i} label={seg.name} chars={seg.text.length} totalChars={totalChars} />
        ))}
        <SegmentBar label="total" chars={totalChars} totalChars={totalChars} />
      </div>
      {capture.usage && (
        <div className="space-y-1 pt-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Real Usage</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] font-mono text-muted-foreground">
            {capture.usage.input_tokens !== undefined && (
              <div><span className="text-foreground">Input:</span> {capture.usage.input_tokens}</div>
            )}
            {capture.usage.output_tokens !== undefined && (
              <div><span className="text-foreground">Output:</span> {capture.usage.output_tokens}</div>
            )}
            {capture.usage.cache_creation_input_tokens !== undefined && (
              <div className="text-blue-600 dark:text-blue-400">
                Cache create: {capture.usage.cache_creation_input_tokens}
              </div>
            )}
            {capture.usage.cache_read_input_tokens !== undefined && (
              <div className="text-green-600 dark:text-green-400">
                Cache read: {capture.usage.cache_read_input_tokens}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="pt-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] gap-1"
          onClick={() => {
            navigator.clipboard.writeText(capture.enhancedSystemPrompt).catch(() => {});
          }}
        >
          <CopyIcon className="h-3 w-3" />
          Copy full prompt ({totalChars}c)
        </Button>
      </div>
    </div>
  );
}

export const PromptInspector = () => {
  const [enabled, setEnabled] = useState(isDebugCaptureEnabled);
  const [captures, setCaptures] = useState<PromptCaptureEntry[]>(getPromptCaptures);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribe(() => {
      setCaptures(getPromptCaptures());
    });
    return unsub;
  }, []);

  // Listen for cross-window storage events (dashboard reads overlay captures)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "prompt_capture_last" && e.newValue) {
        const stored = getLastPromptCapture();
        if (stored) {
          setCaptures((prev) => {
            const exists = prev.some((c) => c.id === stored.id);
            return exists ? prev : [...prev, stored];
          });
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const handleToggle = useCallback(() => {
    const next = !enabled;
    setDebugCaptureEnabled(next);
    setEnabled(next);
  }, [enabled]);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <BugIcon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Prompt Inspector</h3>
            <p className="text-xs text-muted-foreground">
              Capture and analyze prompts sent to AI providers
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={enabled ? "default" : "outline"}
          className="h-7 text-[11px] gap-1.5"
          onClick={handleToggle}
        >
          {enabled ? <EyeOffIcon className="h-3 w-3" /> : <EyeIcon className="h-3 w-3" />}
          {enabled ? "Disable" : "Enable"} Capture
        </Button>
      </div>

      {enabled && captures.length > 0 && (
        <div className="space-y-1">
          {captures.map((c) => (
            <div key={c.id} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {selectedId === c.id ? (
                    <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-medium truncate">{c.providerId}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground truncate">{c.model}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{c.source}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                  <span>{estimateTokens(c.enhancedSystemPrompt)}tok</span>
                  <span className="text-[10px]">{new Date(c.timestamp).toLocaleTimeString()}</span>
                </div>
              </button>
              {selectedId === c.id && (
                <div className="px-3 pb-2 border-t border-border">
                  <CaptureDetail capture={c} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {enabled && captures.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No captures yet. Ask a question to see prompt data here.
        </p>
      )}

      {!enabled && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Capture is off. Enable it to inspect prompts sent during overlay, chat, and audio sessions.
        </p>
      )}
    </div>
  );
};

export default PromptInspector;
