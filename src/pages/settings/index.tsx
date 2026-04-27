import { useState } from "react";
import { useTheme } from "@/contexts";
import {
  Theme,
  AlwaysOnTopToggle,
  AppIconToggle,
  AutostartToggle,
} from "./components";
import { PageLayout } from "@/layouts";
import { Button } from "@/components";
import { SaveIcon, CheckIcon } from "lucide-react";

type ThemeValue = "dark" | "light" | "system";

const Settings = () => {
  const { theme, transparency, setTheme, onSetTransparency } = useTheme();

  const [pendingTheme, setPendingTheme] = useState<ThemeValue>(theme);
  const [pendingTransparency, setPendingTransparency] =
    useState<number>(transparency);
  const [saved, setSaved] = useState(false);

  const hasChanges =
    pendingTheme !== theme || pendingTransparency !== transparency;

  const handleSave = () => {
    if (pendingTheme !== theme) setTheme(pendingTheme);
    onSetTransparency(pendingTransparency);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageLayout
      title="Settings"
      description="Manage your settings"
      rightSlot={
        <Button
          size="sm"
          className="gap-2"
          onClick={handleSave}
          disabled={!hasChanges && !saved}
          variant={saved ? "outline" : "default"}
        >
          {saved ? (
            <>
              <CheckIcon className="h-4 w-4" />
              Saved
            </>
          ) : (
            <>
              <SaveIcon className="h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      }
    >
      {/* Theme */}
      <Theme
        pendingTheme={pendingTheme}
        pendingTransparency={pendingTransparency}
        onThemeChange={setPendingTheme}
        onTransparencyChange={setPendingTransparency}
      />

      {/* Autostart Toggle */}
      <AutostartToggle />

      {/* App Icon Toggle */}
      <AppIconToggle />

      {/* Always On Top Toggle */}
      <AlwaysOnTopToggle />
    </PageLayout>
  );
};

export default Settings;
