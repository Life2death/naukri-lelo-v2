import { Header, Label, Slider, Button } from "@/components";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components";

type ThemeValue = "dark" | "light" | "system";

interface ThemeProps {
  pendingTheme: ThemeValue;
  pendingTransparency: number;
  onThemeChange: (theme: ThemeValue) => void;
  onTransparencyChange: (transparency: number) => void;
}

export const Theme = ({
  pendingTheme,
  pendingTransparency,
  onThemeChange,
  onTransparencyChange,
}: ThemeProps) => {
  const handleTransparencyChange = (value: number[]) => {
    const next = value[0];
    onTransparencyChange(next);
    // Live CSS preview without committing to localStorage yet
    const opacity = (100 - next) / 100;
    document.documentElement.style.setProperty("--opacity", opacity.toString());
    document.documentElement.style.setProperty(
      "--backdrop-blur",
      next > 0 ? "blur(12px)" : "none"
    );
  };

  return (
    <div id="theme" className="relative space-y-3">
      <Header
        title="Theme Customization"
        description="Personalize your experience with custom theme and transparency settings"
        isMainTitle
      />

      {/* Theme Toggle */}
      <div
        className="space-y-2"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                {pendingTheme === "system" ? (
                  <>
                    <MonitorIcon className="h-4 w-4" />
                    System
                  </>
                ) : pendingTheme === "light" ? (
                  <>
                    <SunIcon className="h-4 w-4" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <MoonIcon className="h-4 w-4" />
                    Dark Mode
                  </>
                )}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingTheme === "light"
                  ? "Using light theme for better visibility in bright environments"
                  : "Using dark theme for comfortable viewing in low light"}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                {pendingTheme === "system" ? (
                  <MonitorIcon className="h-[1.2rem] w-[1.2rem]" />
                ) : (
                  <>
                    <SunIcon className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                    <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onThemeChange("light")}>
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onThemeChange("dark")}>
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onThemeChange("system")}>
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Transparency Slider */}
      <div
        className="space-y-2"
      >
        <Header
          title="Window Transparency"
          description="Adjust the transparency level of the application window"
        />
        <div className="space-y-3">
          <div className="flex items-center gap-4 mt-4">
            <Slider
              value={[pendingTransparency]}
              onValueChange={handleTransparencyChange}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground w-10 text-right">
              {pendingTransparency}%
            </span>
          </div>

          <p className="text-xs text-muted-foreground/70">
            Higher transparency lets you see through the window. Click Save to
            apply to the overlay.
          </p>
        </div>
      </div>
    </div>
  );
};
