import { Card, Updater, DragButton, CustomCursor, Button } from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
  ProfileSelector,
  BrainSelector,
  SystemPromptSelector,
} from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { LayoutDashboardIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const platform = getPlatform();

  // `capturing` is set only by the Manual (push-to-talk) path; Auto-detect and
  // Interview set `interviewCapturing` instead. Gating the collapsed bar on
  // `capturing` alone meant that in those two modes the overlay looked
  // completely idle — no visualizer, no status dot — while system audio was
  // being captured and auto-answered.
  const isCapturingAudio = Boolean(
    systemAudio?.capturing || systemAudio?.interviewCapturing
  );

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  };

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout isCompact />;
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div
        className={`w-screen h-screen flex overflow-hidden justify-center items-start ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        <Card className="w-full flex flex-row items-center gap-2 p-2">
          <SystemAudio {...systemAudio} />
          {isCapturingAudio ? (
            <div className="flex flex-row items-center gap-2 justify-between w-full">
              <div className="flex flex-1 items-center gap-2">
                <AudioVisualizer isRecording={isCapturingAudio} />
              </div>
              <div className="flex !w-fit items-center gap-2">
                <StatusIndicator
                  setupRequired={systemAudio.setupRequired}
                  error={systemAudio.error}
                  isProcessing={systemAudio.isProcessing}
                  isAIProcessing={systemAudio.isAIProcessing}
                  capturing={isCapturingAudio}
                />
              </div>
            </div>
          ) : null}

          <div
            className={`${
              isCapturingAudio
                ? "hidden w-full fade-out transition-all duration-300"
                : "w-full flex flex-row gap-2 items-center"
            }`}
          >
            <Completion isHidden={isHidden} />

            {/* Brain selector — pick AI provider + model */}
            <BrainSelector />

            {/* System prompt selector — choose AI mode */}
            <SystemPromptSelector />

            {/* Profile selector — injects profile knowledge hub into AI answers */}
            <ProfileSelector />

            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dashboard"
              onClick={openDashboard}
            >
              <LayoutDashboardIcon className="h-4 w-4" />
            </Button>
          </div>

          <Updater />
          <DragButton />
        </Card>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
