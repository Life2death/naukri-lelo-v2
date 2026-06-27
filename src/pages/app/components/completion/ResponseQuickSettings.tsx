import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
} from "@/components";
import { RESPONSE_LENGTHS } from "@/lib";
import { updateResponseLength, getResponseSettings } from "@/lib";
import { useState, useEffect, useCallback } from "react";
import { Check, ChevronDown } from "lucide-react";

export const ResponseQuickSettings = () => {
  const [selectedLength, setSelectedLength] = useState<string>("short");

  const sync = useCallback(() => {
    const settings = getResponseSettings();
    setSelectedLength(settings.responseLength);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("response-settings-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("response-settings-changed", sync);
    };
  }, [sync]);

  const handleChange = (id: string) => {
    setSelectedLength(id); // update UI immediately; the event/sync keeps the other surfaces in step
    updateResponseLength(id);
  };

  const current = RESPONSE_LENGTHS.find((l) => l.id === selectedLength);
  const label = current?.title || "Short";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-6 px-1.5 text-[11px] font-medium gap-0.5 cursor-pointer"
          title={`Response: ${label}`}
        >
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-44 p-1"
        sideOffset={4}
      >
        {RESPONSE_LENGTHS.map((length) => (
          <Button
            key={length.id}
            variant={selectedLength === length.id ? "secondary" : "ghost"}
            className="w-full justify-start gap-2 text-xs cursor-pointer"
            onClick={() => handleChange(length.id)}
          >
            {selectedLength === length.id ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <span className="h-3.5 w-3.5" />
            )}
            {length.title}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
