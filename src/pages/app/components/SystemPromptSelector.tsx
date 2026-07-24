import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components";
import { useWindowResize, useSystemPrompts } from "@/hooks";
import { MessageSquareTextIcon, CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

export const SystemPromptSelector = () => {
  const { prompts, selectedPromptId, handleSelectPrompt, refreshPrompts } =
    useSystemPrompts();
  const [open, setOpen] = useState(false);
  const { resizeWindow } = useWindowResize();

  // Refresh on every open (same fix already applied to ProfileSelector):
  // this selector lives in the overlay window, but prompts are created in the
  // Dashboard's System Prompts page — a separate window with its own
  // useSystemPrompts() instance. The overlay's list only fetched once on
  // mount, so a prompt created later was invisible here until a full restart.
  const handleOpen = (val: boolean) => {
    setOpen(val);
    resizeWindow(val);
    if (val) {
      refreshPrompts();
    }
  };

  const selectedPrompt = prompts.find((p) => p.id === selectedPromptId) ?? null;

  const handleSelect = (id: number) => {
    handleSelectPrompt(id);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleSelectPrompt(0); // Reset to default
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant={selectedPromptId ? "default" : "ghost"}
          className="relative cursor-pointer shrink-0"
          title={
            selectedPrompt
              ? `Mode: ${selectedPrompt.name}. Click to change.`
              : "Select AI Mode"
          }
        >
          <MessageSquareTextIcon className="h-4 w-4" />
          {selectedPromptId && (
            <span
              className="absolute -top-1 -right-1 flex size-3 items-center justify-center rounded-full bg-green-500 cursor-pointer"
              onClick={handleClear}
              title="Reset to default mode"
            >
              <XIcon className="size-2 text-white" />
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-72 p-2"
        align="end"
        side="bottom"
        sideOffset={6}
      >
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground px-2 pb-1">
            Select AI Mode
          </p>
          <p className="text-[10px] text-muted-foreground/70 px-2 pb-1 leading-relaxed">
            System prompt that shapes how the AI responds.
          </p>

          {prompts.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-3 text-center">
              No prompts yet — create modes in the Dashboard &rarr; System Prompts.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {prompts.map((p) => {
                const isActive = p.id === selectedPromptId;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p.id)}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p
                        className={`text-[10px] truncate ${
                          isActive
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {p.prompt.slice(0, 80)}
                        {p.prompt.length > 80 ? "..." : ""}
                      </p>
                    </div>
                    {isActive && <CheckIcon className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {selectedPromptId && (
            <div className="pt-1 border-t">
              <button
                onClick={() => { handleSelectPrompt(0); setOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive px-2 py-1 text-left transition-colors rounded"
              >
                Reset to default mode
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
