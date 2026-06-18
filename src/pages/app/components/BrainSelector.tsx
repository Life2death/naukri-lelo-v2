import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components";
import { useApp } from "@/contexts";
import { useWindowResize, useOpenRouterModels } from "@/hooks";
import { PROVIDER_MODEL_SUGGESTIONS } from "@/config";
import { BrainIcon, CheckIcon, Loader2, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const BrainSelector = () => {
  const {
    allAiProviders,
    selectedAIProvider,
    providerVariables,
    onSetSelectedAIProvider,
  } = useApp();
  const [open, setOpen] = useState(false);
  const [editingModel, setEditingModel] = useState(false);
  // Local draft for the model field so active typing is never clobbered by
  // background context refreshes (cross-window storage sync). Commits to
  // global state on blur / Enter / chip-click only.
  const [modelDraft, setModelDraft] = useState(
    selectedAIProvider.variables?.model || ""
  );
  const { resizeWindow } = useWindowResize();

  const {
    fetchModels,
    isFetching: isFetchingModels,
    fetchError,
    filteredModels,
    showPicker: showModelPicker,
    closePicker: closeModelPicker,
    search: modelSearch,
    setSearch: setModelSearch,
    dropdownRef,
  } = useOpenRouterModels();

  const handleOpen = (val: boolean) => {
    setOpen(val);
    resizeWindow(val);
    if (!val) setEditingModel(false);
  };

  const isOpenRouter = selectedAIProvider.provider === "openrouter";
  const providerVars = providerVariables[selectedAIProvider.provider];
  const hasKey = !!providerVars?.api_key;
  const currentModel = selectedAIProvider.variables?.model || "";
  const suggestions = PROVIDER_MODEL_SUGGESTIONS[selectedAIProvider.provider] || [];

  const handleSelectProvider = (providerId: string) => {
    onSetSelectedAIProvider({ provider: providerId, variables: {} });
  };

  const handleModelChange = (model: string) => {
    const savedVars = providerVariables[selectedAIProvider.provider] ?? {};
    onSetSelectedAIProvider({
      provider: selectedAIProvider.provider,
      variables: { ...savedVars, ...selectedAIProvider.variables, model },
    });
  };

  // Mirror external model changes into the draft, but never overwrite the
  // value while the user is actively editing the field.
  useEffect(() => {
    if (!editingModel) setModelDraft(currentModel);
  }, [currentModel, editingModel]);

  const handleKeyChange = (key: string) => {
    onSetSelectedAIProvider({
      provider: selectedAIProvider.provider,
      variables: { ...selectedAIProvider.variables, api_key: key },
    });
  };

  const activeLabel = selectedAIProvider.provider
    ? `${selectedAIProvider.provider}${currentModel ? ` · ${currentModel}` : ""}`
    : "Select Brain";

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant={selectedAIProvider.provider ? "default" : "ghost"}
          className="relative cursor-pointer shrink-0"
          title={activeLabel}
        >
          <BrainIcon className="h-4 w-4" />
          {!hasKey && selectedAIProvider.provider && (
            <span className="absolute -top-1 -right-1 flex size-2 rounded-full bg-amber-500" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-80 p-2"
        align="end"
        side="bottom"
        sideOffset={6}
      >
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground px-2">
            Select AI Brain
          </p>

          {/* Provider list */}
          <div className="max-h-40 overflow-y-auto space-y-0.5 px-1">
            {allAiProviders.map((p) => {
              const isActive = p.id === selectedAIProvider.provider;
              const savedVars = providerVariables[p.id || ""];
              const hasSavedKey = !!savedVars?.api_key;
              return (
                <button
                  key={p.id}
                  onClick={() => p.id && handleSelectProvider(p.id)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium capitalize truncate">
                      {p.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!hasSavedKey && (
                      <span
                        className="size-1.5 rounded-full bg-amber-500 shrink-0"
                        title="No API key saved"
                      />
                    )}
                    {isActive && <CheckIcon className="size-3.5 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedAIProvider.provider && (
            <div className="border-t pt-2 px-1 space-y-2">
              {/* API Key field */}
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">
                  API Key
                </p>
                <input
                  type="password"
                  placeholder="Paste your API key..."
                  value={providerVars?.api_key || ""}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  className="w-full text-xs bg-muted/30 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              {/* Model field */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase">
                    Model
                  </p>
                  {isOpenRouter && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={fetchModels}
                      disabled={isFetchingModels}
                      className="shrink-0 h-6 text-[10px] gap-1"
                    >
                      {isFetchingModels ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <SearchIcon className="h-2.5 w-2.5" />
                      )}
                      {isFetchingModels ? "..." : "Browse free"}
                    </Button>
                  )}
                </div>

                {/* OpenRouter free model picker */}
                {isOpenRouter && showModelPicker && (
                  <div className="relative" ref={dropdownRef}>
                    {fetchError && (
                      <p className="text-[10px] text-destructive mb-1">{fetchError}</p>
                    )}
                    <div className="border rounded-md overflow-hidden bg-popover">
                      <div className="flex items-center gap-1 p-1.5 border-b bg-muted/30">
                        <SearchIcon className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        <input
                          className="flex-1 text-[10px] bg-transparent focus:outline-none placeholder:text-muted-foreground"
                          placeholder="Search free models..."
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          autoFocus
                        />
                        <button onClick={closeModelPicker}>
                          <XIcon className="h-2.5 w-2.5 text-muted-foreground hover:text-foreground" />
                        </button>
                      </div>
                      <div className="max-h-36 overflow-y-auto">
                        {filteredModels.length === 0 ? (
                          <p className="text-[10px] text-muted-foreground p-2 text-center">
                            No models match
                          </p>
                        ) : (
                          filteredModels.map((model) => (
                            <button
                              key={model.id}
                              className="w-full text-left px-2 py-1.5 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0"
                              onClick={() => {
                                handleModelChange(model.id);
                                setModelDraft(model.id);
                                closeModelPicker();
                              }}
                            >
                              <p className="text-[10px] font-medium truncate">
                                {model.name}
                              </p>
                              <p className="text-[9px] text-muted-foreground truncate">
                                {model.id}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Model input / suggestions */}
                {!isOpenRouter && (
                  <>
                    {!editingModel && currentModel ? (
                      <button
                        onClick={() => {
                          setModelDraft(currentModel);
                          setEditingModel(true);
                        }}
                        className="w-full text-left text-xs bg-muted/30 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors truncate"
                      >
                        {currentModel}
                      </button>
                    ) : (
                      <input
                        type="text"
                        placeholder={
                          suggestions.length > 0
                            ? `e.g. ${suggestions[0]}`
                            : "Enter model name..."
                        }
                        value={modelDraft}
                        onChange={(e) => setModelDraft(e.target.value)}
                        onBlur={() => {
                          setEditingModel(false);
                          if (modelDraft.trim() !== currentModel) {
                            handleModelChange(modelDraft.trim());
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleModelChange(modelDraft.trim());
                            setEditingModel(false);
                          }
                        }}
                        className="w-full text-xs bg-muted/30 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50"
                        autoFocus
                      />
                    )}
                    {suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {suggestions.map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              handleModelChange(m);
                              setModelDraft(m);
                            }}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                              currentModel === m
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
