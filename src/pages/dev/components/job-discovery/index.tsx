import { useState, useEffect } from "react";
import { Button, Input, Label } from "@/components";
import {
  BriefcaseIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  KeyIcon,
} from "lucide-react";
import { getJobProviderConfig, setJobProviderConfig } from "@/lib";
import { JobProviderId } from "@/types";
import { cn } from "@/lib/utils";

const PROVIDERS: { id: JobProviderId; name: string; free: string; url: string }[] = [
  {
    id: "serper",
    name: "Serper.dev",
    free: "2,500 queries/month free",
    url: "https://serper.dev",
  },
  {
    id: "tavily",
    name: "Tavily",
    free: "1,000 queries/month free",
    url: "https://tavily.com",
  },
];

export const JobDiscoveryConfig = () => {
  const [selectedProvider, setSelectedProvider] = useState<JobProviderId>("serper");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    const cfg = getJobProviderConfig();
    if (cfg) {
      setSelectedProvider(cfg.provider);
      setApiKey(cfg.apiKey);
    }
  }, []);

  const handleSave = () => {
    if (!apiKey.trim()) return;
    setJobProviderConfig({ provider: selectedProvider, apiKey: apiKey.trim() });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      if (selectedProvider === "serper") {
        const res = await tauriFetch("https://google.serper.dev/jobs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": apiKey.trim(),
          },
          body: JSON.stringify({ q: "software engineer jobs", num: 3 }),
        });
        if (res.ok) {
          const data = await res.json() as { jobs?: unknown[] };
          setTestResult(`✓ Connected — returned ${data.jobs?.length ?? 0} jobs`);
        } else {
          const text = await res.text();
          setTestResult(`✗ Error ${res.status}: ${text.substring(0, 120)}`);
        }
      } else {
        const res = await tauriFetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey.trim(),
            query: "software engineer jobs",
            max_results: 3,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { results?: unknown[] };
          setTestResult(`✓ Connected — returned ${data.results?.length ?? 0} results`);
        } else {
          const text = await res.text();
          setTestResult(`✗ Error ${res.status}: ${text.substring(0, 120)}`);
        }
      }
    } catch (err) {
      setTestResult(`✗ ${err instanceof Error ? err.message : "Connection failed"}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <BriefcaseIcon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Job Discovery</h3>
          <p className="text-xs text-muted-foreground">
            Live job search · scored against your resume by your AI provider
          </p>
        </div>
      </div>

      {/* Provider selector */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Provider</Label>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedProvider(p.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-all",
                selectedProvider === p.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80 hover:bg-muted/50"
              )}
            >
              <p className="text-xs font-semibold">{p.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {p.free}
              </p>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Get a free API key at{" "}
          <span className="text-primary">
            {PROVIDERS.find((p) => p.id === selectedProvider)?.url}
          </span>
          . No credit card required.
        </p>
      </div>

      {/* API key input */}
      <div className="space-y-2">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <KeyIcon className="h-3 w-3" />
          API Key
        </Label>
        <div className="relative">
          <Input
            type={showKey ? "text" : "password"}
            placeholder={
              selectedProvider === "serper"
                ? "tvly-xxxxxxxxxxxx"
                : "paste your API key here"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="pr-10 font-mono text-xs"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? (
              <EyeOffIcon className="h-4 w-4" />
            ) : (
              <EyeIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <p
          className={cn(
            "text-xs rounded-md px-3 py-2 border",
            testResult.startsWith("✓")
              ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
              : "text-destructive bg-destructive/10 border-destructive/20"
          )}
        >
          {testResult}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={!apiKey.trim() || isTesting}
          className="flex-1"
        >
          {isTesting ? (
            <Loader2Icon className="h-3 w-3 animate-spin" />
          ) : null}
          Test connection
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!apiKey.trim()}
          className="flex-1"
        >
          {isSaved ? (
            <CheckIcon className="h-3 w-3" />
          ) : null}
          {isSaved ? "Saved!" : "Save"}
        </Button>
      </div>
    </div>
  );
};
