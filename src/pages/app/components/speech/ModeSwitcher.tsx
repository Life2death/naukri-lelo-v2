import { cn } from "@/lib/utils";
import { AudioWaveformIcon, MicIcon, BotIcon } from "lucide-react";

export type CaptureMode = "vad" | "manual" | "interview";

interface ModeSwitcherProps {
  captureMode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  disabled?: boolean;
}

export const ModeSwitcher = ({
  captureMode,
  onModeChange,
  disabled = false,
}: ModeSwitcherProps) => {
  const modes: { id: CaptureMode; label: string; sublabel: string; icon: typeof AudioWaveformIcon }[] = [
    {
      id: "vad",
      label: "Auto-detect",
      sublabel: "(voice activity)",
      icon: AudioWaveformIcon,
    },
    {
      id: "manual",
      label: "Manual",
      sublabel: "(push to talk)",
      icon: MicIcon,
    },
    {
      id: "interview",
      label: "Interview",
      sublabel: "(live + hotkey)",
      icon: BotIcon,
    },
  ];

  return (
    <div
      className={cn(
        "flex bg-muted rounded-lg w-full p-0.5 gap-0.5",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      {modes.map((mode) => {
        const Icon = mode.icon;
        const isActive = captureMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onModeChange(mode.id)}
            disabled={disabled}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-md transition-all",
              isActive
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <div className="flex flex-col items-start">
              <span className="text-xs font-medium leading-tight">
                {mode.label}
              </span>
              <span className="text-[9px] font-normal opacity-60 leading-tight">
                {mode.sublabel}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};
