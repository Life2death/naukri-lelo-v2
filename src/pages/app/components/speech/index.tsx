import { useState, useCallback, useEffect, useRef } from "react";
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
  Slider,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  AudioLinesIcon,
  CameraIcon,
  PlusIcon,
  XIcon,
  RefreshCw,
  SendHorizonalIcon,
  Trash2Icon,
  Maximize2Icon,
  RotateCcwIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ModeSwitcher, CaptureMode } from "./ModeSwitcher";
import { RecordingPanel } from "./RecordingPanel";
import { ResultsSection } from "./ResultsSection";
import { SettingsPanel } from "./SettingsPanel";
import { PermissionFlow } from "./PermissionFlow";
import { QuickActions } from "./QuickActions";
import { Warning } from "./Warning";
import { useSystemAudioType } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import { ResponseQuickSettings } from "../completion/ResponseQuickSettings";
import { RESPONSE_LENGTHS } from "@/lib";
import {
  DEFAULT_OVERLAY_PANEL_SIZE,
  getOverlayPanelSize,
  OVERLAY_SIZE_LIMITS,
  OverlayPanelSize,
} from "@/hooks/useWindow";

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    isPopoverOpen,
    setIsPopoverOpen,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation,
    conversation,
    resizeWindow,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    regenerate,
    vadConfig,
    updateVadConfiguration,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    scrollAreaRef,
    // Interview mode
    captureMode,
    setCaptureMode,
    interviewBufferText,
    interviewCapturing,
    isFireProcessing,
    sttQueueWarning,
    fireInterviewBuffer,
    clearInterviewBuffer,
    useCopilotPrompt,
    setUseCopilotPrompt,
    updateOverlayWindowSize,
  } = props;

  const { supportsImages } = useApp();

  // View mode toggle
  const [conversationMode, setConversationMode] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const modeSwitchInProgressRef = useRef(false);
  const [panelSize, setPanelSize] = useState<OverlayPanelSize>(() =>
    getOverlayPanelSize()
  );

  useEffect(() => {
    const handlePanelSizeChanged = () => {
      setPanelSize(getOverlayPanelSize());
    };

    window.addEventListener("overlay-panel-size-changed", handlePanelSizeChanged);

    return () => {
      window.removeEventListener(
        "overlay-panel-size-changed",
        handlePanelSizeChanged
      );
    };
  }, []);

  // Screenshot state
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  const isVadMode = captureMode === "vad";
  const isInterviewMode = captureMode === "interview";
  const hasResponse = lastAIResponse || isAIProcessing;
  const showPopover =
    isPopoverOpen ||
    capturing ||
    setupRequired ||
    error ||
    interviewCapturing ||
    isInterviewMode;

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  // Keyboard shortcut for Cmd+K to toggle view mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      // Cmd+K or Ctrl+K to toggle view mode
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setConversationMode((prev) => !prev);
      }

      // Enter to fire in interview mode (when panel is focused)
      if (isInterviewMode && e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        fireInterviewBuffer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen, isInterviewMode, fireInterviewBuffer]);

  // Reset screenshot when processing starts (message is being sent)
  useEffect(() => {
    if (isProcessing && screenshotImage) {
      setScreenshotImage(null);
    }
  }, [isProcessing, screenshotImage]);

  const handleToggleCapture = async () => {
    if (capturing || interviewCapturing) {
      await stopCapture();
    } else {
      await startCapture();
    }
  };

  const handleModeChange = async (mode: CaptureMode) => {
    if (mode === captureMode || isSwitchingMode) return;

    // Auto-detect ("vad") and Interview share one always-running capture
    // pipeline. Switching between just those two is a live toggle of
    // auto-answer — no stop/restart — so the transcript is preserved and a
    // question missed in Auto-detect can be recovered by flipping to Interview
    // and firing it.
    const isLiveMode = (m: CaptureMode) => m === "vad" || m === "interview";
    if (
      isLiveMode(mode) &&
      isLiveMode(captureMode) &&
      interviewCapturing
    ) {
      setCaptureMode(mode);
      return;
    }

    modeSwitchInProgressRef.current = true;
    setIsSwitchingMode(true);
    setIsPopoverOpen(true);
    resizeWindow(true);
    try {
      if (
        capturing ||
        interviewCapturing ||
        isRecordingInContinuousMode
      ) {
        await stopCapture(true);
      }

      setCaptureMode(mode);
      await startCapture(mode);
    } finally {
      setIsPopoverOpen(true);
      resizeWindow(true);
      requestAnimationFrame(() => {
        modeSwitchInProgressRef.current = false;
        setIsSwitchingMode(false);
      });
    }
  };

  // Capture screenshot functionality
  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) return;

    setIsCapturingScreenshot(true);
    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac")) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();
        if (!hasPermission) {
          await requestScreenRecordingPermission();
          setIsCapturingScreenshot(false);
          return;
        }
      }

      const base64: string = await invoke("capture_to_base64");

      setScreenshotImage(base64);
    } catch (err) {
      console.error("Failed to capture screenshot:", err);
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot]);

  const handleRemoveScreenshot = useCallback(() => {
    setScreenshotImage(null);
  }, []);

  const handlePanelSizeChange = useCallback(
    async (nextSize: Partial<OverlayPanelSize>) => {
      const savedSize = await updateOverlayWindowSize({
        ...panelSize,
        ...nextSize,
      });
      setPanelSize(savedSize);
    },
    [panelSize, updateOverlayWindowSize]
  );

  const resetPanelSize = useCallback(async () => {
    const savedSize = await updateOverlayWindowSize(DEFAULT_OVERLAY_PANEL_SIZE);
    setPanelSize(savedSize);
  }, [updateOverlayWindowSize]);

  const getButtonIcon = () => {
    if (setupRequired) return <AlertCircleIcon className="text-orange-500" />;
    if (error && !setupRequired)
      return <AlertCircleIcon className="text-red-500" />;
    if (isProcessing) return <LoaderIcon className="animate-spin" />;
    if (capturing || interviewCapturing)
      return <AudioLinesIcon className="text-green-500 animate-pulse" />;
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) return "Setup required - Click for instructions";
    if (error && !setupRequired) return `Error: ${error}`;
    if (isProcessing) return "Transcribing audio...";
    if (capturing || interviewCapturing) return "Stop system audio capture";
    return "Start system audio capture";
  };

  const getButtonClass = () => {
    if (setupRequired) return "";
    if (error && !setupRequired) return "bg-red-100 hover:bg-red-200";
    if (capturing || interviewCapturing) return "bg-green-50 hover:bg-green-100";
    return "";
  };

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (
          !open &&
          (modeSwitchInProgressRef.current ||
            isSwitchingMode ||
            capturing ||
            interviewCapturing)
        ) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleToggleCapture}
          className={cn(getButtonClass())}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>

      {(showPopover) && (
        <PopoverContent
          align="end"
          side="bottom"
          className="select-none w-screen p-0 border shadow-lg overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
            {/* Header - Mode Switcher + Actions */}
            <div className="flex-shrink-0 p-3 border-b border-border/50">
              <div className="flex flex-col gap-2">
                {/* Mode Switcher */}
                {!setupRequired && (
                  <ModeSwitcher
                    captureMode={captureMode}
                    onModeChange={handleModeChange}
                    disabled={
                      isSwitchingMode ||
                      isProcessing ||
                      isAIProcessing ||
                      isFireProcessing
                    }
                  />
                )}
                {setupRequired && (
                  <h2 className="font-semibold text-sm">Setup Required</h2>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-1.5">
                  {!setupRequired && (
                    <>
                      {!isInterviewMode && <ResponseQuickSettings />}

                      {/* Panel size */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 cursor-pointer"
                            title="Adjust live answer panel size"
                          >
                            <Maximize2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="bottom"
                          className="w-60 p-3"
                          sideOffset={4}
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium select-none">
                                Panel size
                              </p>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                title="Reset panel size"
                                onClick={resetPanelSize}
                              >
                                <RotateCcwIcon className="h-3.5 w-3.5" />
                              </Button>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>Width</span>
                                <span>{panelSize.width}px</span>
                              </div>
                              <Slider
                                value={[panelSize.width]}
                                min={OVERLAY_SIZE_LIMITS.minWidth}
                                max={OVERLAY_SIZE_LIMITS.maxWidth}
                                step={20}
                                onValueChange={([width]) => {
                                  if (width) {
                                    setPanelSize((current) => ({
                                      ...current,
                                      width,
                                    }));
                                  }
                                }}
                                onValueCommit={([width]) => {
                                  if (width) {
                                    handlePanelSizeChange({ width });
                                  }
                                }}
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>Height</span>
                                <span>{panelSize.height}px</span>
                              </div>
                              <Slider
                                value={[panelSize.height]}
                                min={OVERLAY_SIZE_LIMITS.minHeight}
                                max={OVERLAY_SIZE_LIMITS.maxHeight}
                                step={20}
                                onValueChange={([height]) => {
                                  if (height) {
                                    setPanelSize((current) => ({
                                      ...current,
                                      height,
                                    }));
                                  }
                                }}
                                onValueCommit={([height]) => {
                                  if (height) {
                                    handlePanelSizeChange({ height });
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Regenerate at length — ported from the typed-completion panel */}
                      {!isInterviewMode && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={isAIProcessing || !lastAIResponse}
                            className="h-6 w-6 cursor-pointer"
                            title="Regenerate this answer at a different length"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="bottom"
                          className="w-44 p-1"
                          sideOffset={4}
                        >
                          <p className="text-[11px] text-muted-foreground px-2 py-1 select-none">
                            Regenerate at length
                          </p>
                          {RESPONSE_LENGTHS.map((length) => (
                            <Button
                              key={length.id}
                              variant="ghost"
                              className="w-full justify-start text-xs cursor-pointer"
                              onClick={() => regenerate(length.id)}
                            >
                              {length.title}
                            </Button>
                          ))}
                        </PopoverContent>
                      </Popover>
                      )}
                    </>
                  )}

                  {/* Screenshot Button */}
                  {!setupRequired && supportsImages && (
                    <Button
                      size="sm"
                      variant={screenshotImage ? "default" : "outline"}
                      onClick={handleCaptureScreenshot}
                      disabled={isCapturingScreenshot}
                      className={cn(
                        "h-6 text-[10px] gap-1 px-2",
                        screenshotImage && "bg-primary text-primary-foreground"
                      )}
                      title="Capture screenshot to include with transcription"
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                      Screenshot
                    </Button>
                  )}

                  {/* New Conversation Button */}
                  {!setupRequired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className="h-6 text-[10px] gap-1 px-2"
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {/* Close Button */}
                  {!capturing && !interviewCapturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Close"
                      onClick={() => {
                        setIsPopoverOpen(false);
                        resizeWindow(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
              <div className="p-2 space-y-2">
                {/* Screenshot Preview */}
                {screenshotImage && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                    <img
                      src={`data:image/png;base64,${screenshotImage}`}
                      alt="Screenshot"
                      className="h-12 w-20 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium">
                        Screenshot attached
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        Will be sent with next transcription
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={handleRemoveScreenshot}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                {/* Error Display */}
                {error && !setupRequired && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium text-red-800">
                        Error
                      </p>
                      <p className="text-[10px] text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {/* Setup Required - Permission Flow */}
                {setupRequired ? (
                  <PermissionFlow
                    onPermissionGranted={() => {
                      startCapture();
                    }}
                    onPermissionDenied={() => {
                      // Keep showing setup instructions
                    }}
                  />
                ) : isInterviewMode ? (
                  /* ──── INTERVIEW MODE UI ──── */
                  <div className="space-y-2">
                    {/* Live Transcript Strip */}
                    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          {interviewCapturing ? (
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                          )}
                          <span className="text-xs font-medium">
                            Live Transcript
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-muted-foreground">
                            {interviewBufferText
                              ? `${interviewBufferText.split(/\s+/).length} words`
                              : "listening..."}
                          </span>
                        </div>
                      </div>

                      <div className="min-h-[3rem] max-h-[6rem] overflow-y-auto text-[11px] text-muted-foreground leading-relaxed bg-background/50 rounded p-2">
                        {interviewBufferText ? (
                          <p>{interviewBufferText}</p>
                        ) : (
                          <p className="italic opacity-50">
                            {interviewCapturing
                              ? "Waiting for speech..."
                              : "Start capture to begin"}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* STT Queue Health Warning */}
                    {sttQueueWarning && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-[10px] text-amber-800">
                        <AlertCircleIcon className="w-3 h-3 flex-shrink-0" />
                        <span>{sttQueueWarning}</span>
                      </div>
                    )}

                    {/* Interview Controls */}
                    <div className="flex gap-2">
                      <Button
                        onClick={fireInterviewBuffer}
                        disabled={
                          !interviewCapturing ||
                          isFireProcessing ||
                          isAIProcessing
                        }
                        size="sm"
                        className="flex-1 gap-1.5"
                      >
                        {isFireProcessing ? (
                          <LoaderIcon className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <SendHorizonalIcon className="w-3.5 h-3.5" />
                        )}
                        Answer now
                      </Button>
                      <Button
                        onClick={clearInterviewBuffer}
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={
                          !interviewBufferText.trim()
                        }
                      >
                        <Trash2Icon className="w-3 h-3" />
                        Clear
                      </Button>
                    </div>

                    {/* Hotkey hint */}
                    <div className="flex justify-center gap-3 text-[8px] text-muted-foreground/60">
                      <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                          {modKey}+Shift+Enter
                        </kbd>{" "}
                        global fire
                      </span>
                      <span>
                        <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                          Enter
                        </kbd>{" "}
                        fire (focused)
                      </span>
                      {interviewCapturing && (
                        <span>
                          <kbd className="px-1 py-0.5 rounded bg-muted font-mono">
                            Esc
                          </kbd>{" "}
                          stop
                        </span>
                      )}
                    </div>

                    {/* AI Response */}
                    <ResultsSection
                      lastTranscription={lastTranscription}
                      lastAIResponse={lastAIResponse}
                      isAIProcessing={isAIProcessing}
                      conversation={conversation}
                      conversationMode={conversationMode}
                      setConversationMode={setConversationMode}
                    />

                    {/* Settings Panel - with interview-specific toggle */}
                    <SettingsPanel
                      vadConfig={vadConfig}
                      onUpdateVadConfig={updateVadConfiguration}
                      useSystemPrompt={useCopilotPrompt}
                      setUseSystemPrompt={setUseCopilotPrompt}
                      contextContent={contextContent}
                      setContextContent={setContextContent}
                      interviewMode={true}
                    />

                    <Warning isVadMode={false} />
                  </div>
                ) : (
                  /* ──── VAD / MANUAL MODE UI (UNCHANGED) ──── */
                  <>
                    {/* Recording Panel */}
                    <RecordingPanel
                      isVadMode={isVadMode}
                      isRecording={isRecordingInContinuousMode}
                      isProcessing={isProcessing}
                      isAIProcessing={isAIProcessing}
                      recordingProgress={recordingProgress}
                      maxDuration={vadConfig.max_recording_duration_secs}
                      onStartRecording={startContinuousRecording}
                      onStopAndSend={manualStopAndSend}
                      onIgnore={ignoreContinuousRecording}
                    />

                    {/* AI Response */}
                    <ResultsSection
                      lastTranscription={lastTranscription}
                      lastAIResponse={lastAIResponse}
                      isAIProcessing={isAIProcessing}
                      conversation={conversation}
                      conversationMode={conversationMode}
                      setConversationMode={setConversationMode}
                    />

                    {/* Settings Panel */}
                    <SettingsPanel
                      vadConfig={vadConfig}
                      onUpdateVadConfig={updateVadConfiguration}
                      useSystemPrompt={useSystemPrompt}
                      setUseSystemPrompt={setUseSystemPrompt}
                      contextContent={contextContent}
                      setContextContent={setContextContent}
                    />

                    {/* Help/Keyboard Shortcuts */}
                    <Warning isVadMode={isVadMode} />
                  </>
                )}
              </div>
            </ScrollArea>

            {/* Quick Actions */}
            {!setupRequired && hasResponse && (
              <div className="flex-shrink-0 border-t border-border/50 p-2">
                <QuickActions
                  actions={quickActions}
                  onActionClick={handleQuickActionClick}
                  onAddAction={addQuickAction}
                  onRemoveAction={removeQuickAction}
                  isManaging={isManagingQuickActions}
                  setIsManaging={setIsManagingQuickActions}
                  show={showQuickActions}
                  setShow={setShowQuickActions}
                />
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};
