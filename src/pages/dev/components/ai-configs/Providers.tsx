import { Button, Header, Input, Selection, TextInput } from "@/components";
import { UseSettingsReturn } from "@/types";
import curl2Json, { ResultJSON } from "@bany/curl-to-json";
import { KeyIcon, Loader2, SearchIcon, TrashIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FreeModel {
  id: string;
  name: string;
}

export const Providers = ({
  allAiProviders,
  selectedAIProvider,
  onSetSelectedAIProvider,
  variables,
}: UseSettingsReturn) => {
  const [localSelectedProvider, setLocalSelectedProvider] =
    useState<ResultJSON | null>(null);

  // Browse free models state
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [freeModels, setFreeModels] = useState<FreeModel[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [fetchError, setFetchError] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedAIProvider?.provider) {
      const provider = allAiProviders?.find(
        (p) => p?.id === selectedAIProvider?.provider
      );
      if (provider) {
        const json = curl2Json(provider?.curl);
        setLocalSelectedProvider(json as ResultJSON);
      }
    }
    // Close model picker when provider changes
    setShowModelPicker(false);
    setFreeModels([]);
  }, [selectedAIProvider?.provider]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    if (showModelPicker) {
      document.addEventListener("mousedown", handler);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  const findKeyAndValue = (key: string) => {
    return variables?.find((v) => v?.key === key);
  };

  const getApiKeyValue = () => {
    const apiKeyVar = findKeyAndValue("api_key");
    if (!apiKeyVar || !selectedAIProvider?.variables) return "";
    return selectedAIProvider?.variables?.[apiKeyVar.key] || "";
  };

  const isApiKeyEmpty = () => !getApiKeyValue().trim();

  const isOpenRouter = selectedAIProvider?.provider === "openrouter";

  const fetchFreeModels = async () => {
    setIsFetchingModels(true);
    setFetchError("");
    setFreeModels([]);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const free: FreeModel[] = (data.data || [])
        .filter((m: any) => typeof m.id === "string" && m.id.endsWith(":free"))
        .map((m: any) => ({ id: m.id, name: m.name || m.id }))
        .sort((a: FreeModel, b: FreeModel) => a.name.localeCompare(b.name));
      if (free.length === 0) {
        setFetchError("No free models found. OpenRouter may have changed their API.");
      } else {
        setFreeModels(free);
        setShowModelPicker(true);
      }
    } catch (e) {
      setFetchError("Failed to fetch models. Check your internet connection.");
    } finally {
      setIsFetchingModels(false);
    }
  };

  const filteredModels = freeModels.filter(
    (m) =>
      m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.name.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {isOpenRouter && isApiKeyEmpty() && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-400">
            ✦ Recommended: OpenRouter — 100+ AI models, many completely free
          </p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>
              Visit{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline underline-offset-2"
              >
                openrouter.ai/keys
              </a>{" "}
              and sign up for free (no credit card needed)
            </li>
            <li>Click <strong>Create Key</strong>, copy it</li>
            <li>Paste it in the API Key field below</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Use the <strong>Browse free models</strong> button below to see all currently available free models.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Header
          title="Select AI Provider"
          description="Select your preferred AI service provider or custom providers to get started."
        />
        <Selection
          selected={selectedAIProvider?.provider}
          options={allAiProviders?.map((provider) => {
            const json = curl2Json(provider?.curl);
            return {
              label: provider?.isCustom
                ? json?.url || "Custom Provider"
                : provider?.id || "Custom Provider",
              value: provider?.id || "Custom Provider",
              isCustom: provider?.isCustom,
            };
          })}
          placeholder="Choose your AI provider"
          onChange={(value) => {
            onSetSelectedAIProvider({ provider: value, variables: {} });
          }}
        />
      </div>

      {localSelectedProvider ? (
        <Header
          title={`Method: ${localSelectedProvider?.method || "Invalid"}, Endpoint: ${localSelectedProvider?.url || "Invalid"}`}
          description="If you want to use a different url or method, create a custom provider."
        />
      ) : null}

      {findKeyAndValue("api_key") ? (
        <div className="space-y-2">
          <Header
            title="API Key"
            description={`Enter your ${
              allAiProviders?.find((p) => p?.id === selectedAIProvider?.provider)?.isCustom
                ? "Custom Provider"
                : selectedAIProvider?.provider
            } API key. Stored locally, never shared.`}
          />
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="**********"
              value={getApiKeyValue()}
              onChange={(value) => {
                const apiKeyVar = findKeyAndValue("api_key");
                if (!apiKeyVar || !selectedAIProvider) return;
                onSetSelectedAIProvider({
                  ...selectedAIProvider,
                  variables: {
                    ...selectedAIProvider.variables,
                    [apiKeyVar.key]: typeof value === "string" ? value : value.target.value,
                  },
                });
              }}
              onKeyDown={(e) => {
                const apiKeyVar = findKeyAndValue("api_key");
                if (!apiKeyVar || !selectedAIProvider) return;
                onSetSelectedAIProvider({
                  ...selectedAIProvider,
                  variables: {
                    ...selectedAIProvider.variables,
                    [apiKeyVar.key]: (e.target as HTMLInputElement).value,
                  },
                });
              }}
              disabled={false}
              className="flex-1 h-11 border-1 border-input/50 focus:border-primary/50 transition-colors"
            />
            {isApiKeyEmpty() ? (
              <Button
                disabled
                size="icon"
                className="shrink-0 h-11 w-11"
                title="Submit API Key"
              >
                <KeyIcon className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  const apiKeyVar = findKeyAndValue("api_key");
                  if (!apiKeyVar || !selectedAIProvider) return;
                  onSetSelectedAIProvider({
                    ...selectedAIProvider,
                    variables: { ...selectedAIProvider.variables, [apiKeyVar.key]: "" },
                  });
                }}
                size="icon"
                variant="destructive"
                className="shrink-0 h-11 w-11"
                title="Remove API Key"
              >
                <TrashIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div className="space-y-4 mt-2">
        {variables
          .filter((variable) => variable.key !== findKeyAndValue("api_key")?.key)
          .map((variable) => {
            const getVariableValue = () => {
              if (!variable?.key || !selectedAIProvider?.variables) return "";
              return selectedAIProvider.variables[variable.key] || "";
            };

            return (
              <div className="space-y-1" key={variable?.key}>
                <div className="flex items-center justify-between gap-2">
                  <Header
                    title={variable?.value || ""}
                    description={`Add your preferred ${variable?.key?.replace(/_/g, " ")} for ${
                      allAiProviders?.find((p) => p?.id === selectedAIProvider?.provider)?.isCustom
                        ? "Custom Provider"
                        : selectedAIProvider?.provider
                    }`}
                  />
                  {/* Browse free models button — only for OpenRouter model field */}
                  {isOpenRouter && variable.key === "model" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={fetchFreeModels}
                      disabled={isFetchingModels}
                      className="shrink-0 h-7 text-xs gap-1.5"
                    >
                      {isFetchingModels ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <SearchIcon className="h-3 w-3" />
                      )}
                      {isFetchingModels ? "Loading..." : "Browse free models"}
                    </Button>
                  )}
                </div>

                {/* Free models dropdown */}
                {isOpenRouter && variable.key === "model" && (
                  <div className="relative" ref={dropdownRef}>
                    {fetchError && (
                      <p className="text-xs text-destructive mb-1">{fetchError}</p>
                    )}
                    {showModelPicker && freeModels.length > 0 && (
                      <div className="absolute z-50 w-full bg-popover border rounded-md shadow-xl overflow-hidden">
                        {/* Search bar */}
                        <div className="flex items-center gap-1 p-2 border-b bg-muted/30 sticky top-0">
                          <SearchIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                          <input
                            className="flex-1 text-xs bg-transparent focus:outline-none placeholder:text-muted-foreground"
                            placeholder={`Search ${freeModels.length} free models...`}
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            autoFocus
                          />
                          <button
                            onClick={() => { setShowModelPicker(false); setModelSearch(""); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </div>
                        {/* Model list */}
                        <div className="max-h-52 overflow-y-auto">
                          {filteredModels.length === 0 ? (
                            <p className="text-xs text-muted-foreground p-3 text-center">
                              No models match "{modelSearch}"
                            </p>
                          ) : (
                            filteredModels.map((model) => (
                              <button
                                key={model.id}
                                className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                                onClick={() => {
                                  const modelVar = findKeyAndValue("model");
                                  if (!modelVar || !selectedAIProvider) return;
                                  onSetSelectedAIProvider({
                                    ...selectedAIProvider,
                                    variables: {
                                      ...selectedAIProvider.variables,
                                      [modelVar.key]: model.id,
                                    },
                                  });
                                  setShowModelPicker(false);
                                  setModelSearch("");
                                }}
                              >
                                <div className="text-xs font-medium truncate">{model.name}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{model.id}</div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <TextInput
                  placeholder={`Enter ${
                    allAiProviders?.find((p) => p?.id === selectedAIProvider?.provider)?.isCustom
                      ? "Custom Provider"
                      : selectedAIProvider?.provider
                  } ${variable?.key?.replace(/_/g, " ") || "value"}`}
                  value={getVariableValue()}
                  onChange={(value) => {
                    if (!variable?.key || !selectedAIProvider) return;
                    onSetSelectedAIProvider({
                      ...selectedAIProvider,
                      variables: { ...selectedAIProvider.variables, [variable.key]: value },
                    });
                  }}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
};
