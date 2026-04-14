import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components";
import { useApp } from "@/contexts";
import { getAllProfiles } from "@/lib";
import { useWindowResize } from "@/hooks";
import { InterviewProfile } from "@/types";
import { CheckIcon, UserCircle2Icon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const ProfileSelector = () => {
  const { activeProfileId, setActiveProfileId } = useApp();
  const [profiles, setProfiles] = useState<InterviewProfile[]>([]);
  const [open, setOpen] = useState(false);
  const { resizeWindow } = useWindowResize();

  // Load profiles eagerly on mount
  useEffect(() => {
    getAllProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  const handleOpen = async (val: boolean) => {
    if (val) {
      // Expand the overlay window BEFORE opening the popover so the content is visible
      await resizeWindow(true);
      setOpen(true);
    } else {
      setOpen(false);
      // The MutationObserver in useWindowResize collapses the window automatically
      // when [data-radix-popper-content-wrapper] is removed from the DOM.
    }
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  const handleSelect = (id: string) => {
    setActiveProfileId(activeProfileId === id ? null : id);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveProfileId(null);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="default"
          className={`relative cursor-pointer shrink-0 ${
            activeProfileId
              ? "bg-green-500 hover:bg-green-600 text-white border-0"
              : ""
          }`}
          title={
            activeProfile
              ? `Active Profile: ${activeProfile.name}. Click to change.`
              : "Select Interview Profile"
          }
        >
          <UserCircle2Icon className="h-4 w-4" />
          {activeProfileId && (
            <span
              className="absolute -top-1 -right-1 flex size-3 items-center justify-center rounded-full bg-white cursor-pointer"
              onClick={handleClear}
              title="Clear active profile"
            >
              <XIcon className="size-2 text-green-600" />
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
            Select Interview Profile
          </p>
          <p className="text-[10px] text-muted-foreground/70 px-2 pb-1 leading-relaxed">
            AI answers will use your resume, documents, and prep history as context.
          </p>

          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-3 text-center">
              No profiles yet. Create one in the Dashboard.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {profiles.map((p) => {
                const isActive = p.id === activeProfileId;
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
                      {p.goals && (
                        <p
                          className={`text-[10px] truncate ${
                            isActive
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {p.goals}
                        </p>
                      )}
                    </div>
                    {isActive && <CheckIcon className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {activeProfileId && (
            <div className="pt-1 border-t">
              <button
                onClick={() => { setActiveProfileId(null); setOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive px-2 py-1 text-left transition-colors rounded"
              >
                Clear active profile
              </button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
