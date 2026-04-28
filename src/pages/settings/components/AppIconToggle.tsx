import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";

interface AppIconToggleProps {
  className?: string;
}

export const AppIconToggle = ({ className }: AppIconToggleProps) => {
  const { customizable, toggleAppIconVisibility } = useApp();

  const handleSwitchChange = async (checked: boolean) => {
    await toggleAppIconVisibility(checked);
  };

  return (
    <div id="app-icon" className={`space-y-2 ${className}`}>
      <Header
        title="App Icon Stealth Mode"
        description="Control dock/taskbar icon visibility when window is hidden for maximum discretion"
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {customizable.appIcon.isVisible
                ? "Tray Icon Visible"
                : "Tray Icon Hidden"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {customizable.appIcon.isVisible
                ? "App icon is shown in the system tray. Toggle off to hide it."
                : "App icon is hidden from the system tray. Toggle on to show it."}
            </p>
          </div>
        </div>
        <Switch
          checked={customizable.appIcon.isVisible}
          onCheckedChange={handleSwitchChange}
          aria-label="Toggle app icon visibility"
        />
      </div>
    </div>
  );
};
