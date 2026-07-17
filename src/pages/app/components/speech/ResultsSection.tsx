import { ChatConversation } from "@/types";
import {
  Button,
  CopyButton,
  Markdown,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
  Switch,
} from "@/components";
import {
  BotIcon,
  HeadphonesIcon,
  Loader2,
  PauseIcon,
  PlayIcon,
  Settings2Icon,
  SparklesIcon,
  SquareIcon,
  Volume2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useLiveAnswerSpeech,
  SPEECH_RATE_MIN,
  SPEECH_RATE_MAX,
} from "@/hooks";

type Props = {
  lastTranscription: string;
  lastAIResponse: string;
  isAIProcessing: boolean;
  conversation: ChatConversation;
  conversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
};

export const ResultsSection = ({
  lastTranscription,
  lastAIResponse,
  isAIProcessing,
  conversation,
  conversationMode,
  setConversationMode,
}: Props) => {
  const hasResponse = lastAIResponse || isAIProcessing;
  const hasHistory = conversation.messages.length > 2;
  const speech = useLiveAnswerSpeech(lastAIResponse, isAIProcessing);

  if (!hasResponse && !lastTranscription) {
    return null;
  }

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">
            {conversationMode ? "Conversation" : "AI Response"}
          </h4>
        </div>
        <div className="flex items-center gap-1 select-none">
          <span className="text-[9px] text-muted-foreground/50 bg-muted/50 px-1 rounded">
            {modKey}+K
          </span>
          <Switch
            checked={conversationMode}
            onCheckedChange={setConversationMode}
            className="scale-75"
          />
          {speech.supported && (
            <>
              <Switch
                checked={speech.enabled}
                onCheckedChange={speech.setEnabled}
                className="scale-75"
                aria-label="Speak completed answers automatically"
                title="Speak completed answers automatically"
              />
              {lastAIResponse && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title={speech.isSpeaking ? "Stop spoken answer" : "Read answer aloud"}
                  onClick={() =>
                    speech.isSpeaking ? speech.stop() : speech.speak()
                  }
                >
                  {speech.isSpeaking ? (
                    <SquareIcon className="h-3.5 w-3.5" />
                  ) : (
                    <Volume2Icon className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              {speech.isSpeaking && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title={speech.isPaused ? "Resume spoken answer" : "Pause spoken answer"}
                  onClick={speech.togglePause}
                >
                  {speech.isPaused ? (
                    <PlayIcon className="h-3.5 w-3.5" />
                  ) : (
                    <PauseIcon className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    title="Spoken answer settings"
                  >
                    <Settings2Icon className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" className="w-40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Volume2Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <Switch
                      checked={speech.enabled}
                      onCheckedChange={speech.setEnabled}
                      aria-label="Speak completed answers automatically"
                      title="Speak completed answers automatically"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Slider
                      value={[speech.rate]}
                      min={SPEECH_RATE_MIN}
                      max={SPEECH_RATE_MAX}
                      step={0.1}
                      onValueChange={([rate]) => speech.setRate(rate)}
                      aria-label="Speech rate"
                    />
                    <span className="w-8 text-right text-[10px] text-muted-foreground">
                      {speech.rate.toFixed(1)}x
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            </>
          )}
          {lastAIResponse && <CopyButton content={lastAIResponse} />}
        </div>
      </div>

      {/* RESPONSE MODE: System as text, then AI response */}
      {!conversationMode && (
        <div className="space-y-2">
          {/* System Input - Just text with bold label */}
          {lastTranscription && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold">System:</span> {lastTranscription}
            </p>
          )}

          {/* AI Response */}
          {hasResponse && (
            <div>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Generating response...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CONVERSATION MODE: AI on top, then System, then history */}
      {conversationMode && (
        <div className="space-y-2">
          {/* AI Response - First (on top) */}
          {hasResponse && (
            <div className="rounded-md bg-background/50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <BotIcon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
                  AI
                </span>
              </div>
              {isAIProcessing && !lastAIResponse ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    Generating...
                  </span>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert text-sm">
                  <Markdown>{lastAIResponse}</Markdown>
                  {isAIProcessing && (
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* System Input - Second */}
          {lastTranscription && (
            <div className="rounded-md border-l-2 border-primary/50 bg-primary/5 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <HeadphonesIcon className="h-3 w-3 text-primary" />
                <span className="text-[9px] font-medium text-primary uppercase tracking-wide">
                  System
                </span>
              </div>
              <p className="text-sm">{lastTranscription}</p>
            </div>
          )}

          {/* Previous Messages */}
          {hasHistory && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
                Previous
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {conversation.messages
                  .slice(2)
                  .sort((a, b) => b.timestamp - a.timestamp)
                  .map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "p-2 rounded-md text-[11px]",
                        message.role === "user"
                          ? "bg-primary/5 border-l-2 border-primary/30"
                          : "bg-background/50"
                      )}
                    >
                      <span className="text-[8px] font-medium text-muted-foreground uppercase">
                        {message.role === "user" ? "System" : "AI"}
                      </span>
                      <div className="text-muted-foreground leading-relaxed mt-0.5">
                        <Markdown>{message.content}</Markdown>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
