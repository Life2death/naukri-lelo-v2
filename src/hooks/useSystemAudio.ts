import { useEffect, useState, useCallback, useRef } from "react";
import { useWindowResize, useGlobalShortcuts } from ".";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { fetchSTT, fetchAIResponseWithFailover } from "@/lib/functions";
import { getFailoverEnabled, getFailoverChain } from "@/lib/storage";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_SYSTEM_PROMPT,
  STORAGE_KEYS,
  INTERVIEW_COPILOT_PROMPT,
} from "@/config";
import {
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  getProfileById,
  buildProfileKnowledgeContext,
  buildProfileBriefContext,
  loadProfileRefConvTexts,
} from "@/lib";
import { Message } from "@/types/completion";
import { InterviewProfile } from "@/types";
import { CaptureMode } from "@/pages/app/components/speech/ModeSwitcher";

// VAD Configuration interface matching Rust
export interface VadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

export interface InterviewChunk {
  seq: number;
  text: string;
}

// OPTIMIZED VAD defaults - matches backend exactly for perfect performance
const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012, // Much less sensitive - only real speech
  peak_threshold: 0.035, // Higher threshold - filters clicks/noise
  silence_chunks: 45, // ~1.0s of required silence
  min_speech_chunks: 7, // ~0.16s - captures short answers
  pre_speech_chunks: 12, // ~0.27s - enough to catch word start
  noise_gate_threshold: 0.003, // Stronger noise filtering
  max_recording_duration_secs: 180, // 3 minutes default
};

// Chat message interface (reusing from useCompletion)
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// Conversation interface (reusing from useCompletion)
export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow, updateOverlayWindowSize } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string>("");
  const [lastAIResponse, setLastAIResponse] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [isManagingQuickActions, setIsManagingQuickActions] =
    useState<boolean>(false);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(true);
  const [vadConfig, setVadConfig] = useState<VadConfig>(DEFAULT_VAD_CONFIG);
  const [recordingProgress, setRecordingProgress] = useState<number>(0); // For continuous mode
  const [isContinuousMode, setIsContinuousMode] = useState<boolean>(false);
  const [isRecordingInContinuousMode, setIsRecordingInContinuousMode] =
    useState<boolean>(false);

  // Capture mode: "vad" | "manual" | "interview"
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => {
    const stored = safeLocalStorage.getItem(STORAGE_KEYS.CAPTURE_MODE);
    if (stored === "vad" || stored === "manual" || stored === "interview") {
      return stored;
    }
    return vadConfig.enabled ? "vad" : "manual";
  });

  // Interview mode state
  const [interviewChunks, setInterviewChunks] = useState<InterviewChunk[]>([]);
  const [interviewBufferText, setInterviewBufferText] = useState<string>("");
  const [isFireProcessing, setIsFireProcessing] = useState(false);
  const [sttQueueWarning, setSttQueueWarning] = useState<string>("");
  const [interviewCapturing, setInterviewCapturing] = useState(false);
  // Whether the interview mode is using the co-pilot prompt vs system prompt
  const [useCopilotPrompt, setUseCopilotPrompt] = useState<boolean>(true);

  const [conversation, setConversation] = useState<ChatConversation>({
    id: "",
    title: "",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  });

  // Context management states
  const [useSystemPrompt, setUseSystemPrompt] = useState<boolean>(true);
  const [contextContent, setContextContent] = useState<string>("");

  const {
    selectedSttProvider,
    allSttProviders,
    selectedAIProvider,
    allAiProviders,
    providerVariables,
    systemPrompt,
    selectedAudioDevices,
    activeProfileId,
  } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Cache the active interview profile's knowledge context, same as useCompletion,
  // so voice-driven answers get the resume/JD context too instead of a bare system prompt.
  const activeProfileRef = useRef<InterviewProfile | null>(null);
  const profileContextRef = useRef<string>("");
  const profileBriefRef = useRef<string>("");

  useEffect(() => {
    if (!activeProfileId) {
      activeProfileRef.current = null;
      profileContextRef.current = "";
      profileBriefRef.current = "";
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const profile = await getProfileById(activeProfileId);
        if (cancelled || !profile) return;
        activeProfileRef.current = profile;
        const refTexts = await loadProfileRefConvTexts(activeProfileId);
        if (cancelled) return;
        profileContextRef.current = buildProfileKnowledgeContext(profile, refTexts);
        profileBriefRef.current = buildProfileBriefContext(profile, refTexts);
      } catch {
        activeProfileRef.current = null;
        profileContextRef.current = "";
        profileBriefRef.current = "";
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfileId]);

  /** Prepends the active profile's knowledge context (brief, falling back to full) to the base system/context prompt. */
  const buildEffectiveSystemPrompt = useCallback((): {
    text: string;
    segments: { name: string; text: string }[];
  } => {
    const isInterviewMode = captureMode === "interview";
    const base = isInterviewMode
      ? useCopilotPrompt
        ? INTERVIEW_COPILOT_PROMPT
        : useSystemPrompt
          ? systemPrompt || DEFAULT_SYSTEM_PROMPT
          : contextContent || DEFAULT_SYSTEM_PROMPT
      : useSystemPrompt
        ? systemPrompt || DEFAULT_SYSTEM_PROMPT
        : contextContent || DEFAULT_SYSTEM_PROMPT;
    const profileCtx = profileBriefRef.current || profileContextRef.current;
    if (!profileCtx) {
      return { text: base, segments: [{ name: "base", text: base }] };
    }
    return {
      text: `${profileCtx}\n\n---\n\n${base}`,
      segments: [
        { name: "profileContext", text: profileCtx },
        { name: "base", text: base },
      ],
    };
  }, [useSystemPrompt, systemPrompt, contextContent, captureMode, useCopilotPrompt]);

  // Load context settings and VAD config from localStorage on mount
  useEffect(() => {
    const savedContext = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT
    );
    if (savedContext) {
      try {
        const parsed = JSON.parse(savedContext);
        setUseSystemPrompt(parsed.useSystemPrompt ?? true);
        setContextContent(parsed.contextContent ?? "");
      } catch (error) {
        console.error("Failed to load system audio context:", error);
      }
    }

    // Load VAD config
    const savedVadConfig = safeLocalStorage.getItem("vad_config");
    if (savedVadConfig) {
      try {
        const parsed = JSON.parse(savedVadConfig);
        setVadConfig(parsed);
      } catch (error) {
        console.error("Failed to load VAD config:", error);
      }
    }
  }, []);

  // Load quick actions from localStorage on mount
  useEffect(() => {
    const savedActions = safeLocalStorage.getItem(
      STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
    );
    if (savedActions) {
      try {
        const parsed = JSON.parse(savedActions);
        setQuickActions(parsed);
      } catch (error) {
        console.error("Failed to load quick actions:", error);
        setQuickActions(DEFAULT_QUICK_ACTIONS);
      }
    } else {
      setQuickActions(DEFAULT_QUICK_ACTIONS);
    }
  }, []);

  // Persist captureMode changes
  const handleCaptureModeChange = useCallback((mode: CaptureMode) => {
    setCaptureMode(mode);
    safeLocalStorage.setItem(STORAGE_KEYS.CAPTURE_MODE, mode);
  }, []);

  // Interview mode: listen for audio chunk events and process them
  useEffect(() => {
    if (captureMode !== "interview") return;

    let unlistenChunk: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        unlistenChunk = await listen("interview-audio-chunk", (event) => {
          const payload = event.payload as { seq: number; base64: string };
          if (!payload?.base64) return;

          // Process chunk through STT
          processChunk(payload.seq, payload.base64);
        });

        unlistenError = await listen("interview-capture-error", (event) => {
          const msg = event.payload as string;
          setError(`Interview capture error: ${msg}`);
        });

        unlistenStopped = await listen("interview-capture-stopped", () => {
          setInterviewCapturing(false);
        });
      } catch (err) {
        console.error("Failed to setup interview listeners:", err);
      }
    };

    let processingCount = 0;
    const processingQueue: { seq: number; base64: string }[] = [];
    let isProcessing = false;

    const processChunk = (seq: number, base64: string) => {
      processingQueue.push({ seq, base64 });
      processQueue();
    };

    const processQueue = async () => {
      if (isProcessing || processingQueue.length === 0) return;
      isProcessing = true;

      while (processingQueue.length > 0) {
        const item = processingQueue.shift()!;
        processingCount++;
        if (processingCount > 3) {
          setSttQueueWarning("STT queue depth > 3 — transcription may be behind");
        }

        try {
          const binaryString = atob(item.base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const audioBlob = new Blob([bytes], { type: "audio/wav" });

          if (!selectedSttProvider.provider) {
            setSttQueueWarning("No STT provider configured");
            return;
          }

          const providerConfig = allSttProviders.find(
            (p) => p.id === selectedSttProvider.provider
          );
          if (!providerConfig) {
            setSttQueueWarning("STT provider config not found");
            setInterviewChunks((prev) => [
              ...prev,
              { seq: item.seq, text: "[unclear]" },
            ]);
            continue;
          }

          let transcription: string;
          try {
            transcription = await fetchSTT({
              provider: providerConfig,
              selectedProvider: selectedSttProvider,
              audio: audioBlob,
            });
          } catch {
            setInterviewChunks((prev) => [
              ...prev,
              { seq: item.seq, text: "[unclear]" },
            ]);
            continue;
          }

          // Filter junk transcripts
          const trimmed = transcription.trim().toLowerCase();
          if (
            !trimmed ||
            trimmed === "thank you." ||
            trimmed === "thanks for watching!" ||
            trimmed === "you" ||
            trimmed === "."
          ) {
            continue;
          }

          setInterviewChunks((prev) => {
            const updated = [...prev, { seq: item.seq, text: transcription.trim() }];
            // Update buffer text: ordered concatenation
            const ordered = updated.sort((a, b) => a.seq - b.seq);
            setInterviewBufferText(ordered.map((c) => c.text).join(" "));
            return updated;
          });

          processingCount = Math.max(0, processingCount - 1);
          if (processingCount <= 2) {
            setSttQueueWarning("");
          }
        } catch {
          setInterviewChunks((prev) => [
            ...prev,
            { seq: item.seq, text: "[unclear]" },
          ]);
        }
      }

      isProcessing = false;
    };

    setupListeners();

    return () => {
      if (unlistenChunk) unlistenChunk();
      if (unlistenError) unlistenError();
      if (unlistenStopped) unlistenStopped();
    };
  }, [captureMode, selectedSttProvider, allSttProviders]);

  // Handle continuous recording progress events AND error events
  useEffect(() => {
    let progressUnlisten: (() => void) | undefined;
    let startUnlisten: (() => void) | undefined;
    let stopUnlisten: (() => void) | undefined;
    let errorUnlisten: (() => void) | undefined;
    let discardedUnlisten: (() => void) | undefined;

    const setupContinuousListeners = async () => {
      try {
        // Progress updates (every second)
        progressUnlisten = await listen("recording-progress", (event) => {
          const seconds = event.payload as number;
          setRecordingProgress(seconds);
        });

        // Recording started
        startUnlisten = await listen("continuous-recording-start", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(true);
        });

        // Recording stopped
        stopUnlisten = await listen("continuous-recording-stopped", () => {
          setRecordingProgress(0);
          setIsRecordingInContinuousMode(false);
        });

        // Audio encoding errors
        errorUnlisten = await listen("audio-encoding-error", (event) => {
          const errorMsg = event.payload as string;
          console.error("Audio encoding error:", errorMsg);
          setError(`Failed to process audio: ${errorMsg}`);
          setIsProcessing(false);
          setIsAIProcessing(false);
          setIsRecordingInContinuousMode(false);
        });

        // Speech discarded (too short)
        discardedUnlisten = await listen("speech-discarded", (event) => {
          const reason = event.payload as string;
          console.log("Speech discarded:", reason);
          // Don't show error - this is expected behavior
        });
      } catch (err) {
        console.error("Failed to setup continuous recording listeners:", err);
      }
    };

    setupContinuousListeners();

    return () => {
      if (progressUnlisten) progressUnlisten();
      if (startUnlisten) startUnlisten();
      if (stopUnlisten) stopUnlisten();
      if (errorUnlisten) errorUnlisten();
      if (discardedUnlisten) discardedUnlisten();
    };
  }, []);

  // Handle single speech detection event (both VAD and continuous modes)
  useEffect(() => {
    let speechUnlisten: (() => void) | undefined;

    const setupEventListener = async () => {
      try {
        speechUnlisten = await listen("speech-detected", async (event) => {
          try {
            if (!capturing) return;

            const base64Audio = event.payload as string;
            // Convert to blob
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const audioBlob = new Blob([bytes], { type: "audio/wav" });

            if (!selectedSttProvider.provider) {
              setError("No speech provider selected.");
              return;
            }

            const providerConfig = allSttProviders.find(
              (p) => p.id === selectedSttProvider.provider
            );

            if (!providerConfig) {
              setError("Speech provider config not found.");
              return;
            }

            setIsProcessing(true);

            // Add timeout wrapper for STT request (30 seconds)
            const sttPromise = fetchSTT({
              provider: providerConfig,
              selectedProvider: selectedSttProvider,
              audio: audioBlob,
            });

            const timeoutPromise = new Promise<string>((_, reject) => {
              setTimeout(
                () => reject(new Error("Speech transcription timed out (30s)")),
                30000
              );
            });

            try {
              const transcription = await Promise.race([
                sttPromise,
                timeoutPromise,
              ]);

              if (transcription.trim()) {
                setLastTranscription(transcription);
                setError("");

                const effectivePrompt = buildEffectiveSystemPrompt();

                const previousMessages = conversation.messages.map((msg) => {
                  return { role: msg.role, content: msg.content };
                });

                await processWithAI(
                  transcription,
                  effectivePrompt.text,
                  previousMessages,
                  effectivePrompt.segments
                );
              } else {
                setError("Received empty transcription");
              }
            } catch (sttError: any) {
              console.error("STT Error:", sttError);
              setError(sttError.message || "Failed to transcribe audio");
              setIsPopoverOpen(true);
            }
          } catch (err) {
            setError("Failed to process speech");
          } finally {
            setIsProcessing(false);
          }
        });
      } catch (err) {
        setError("Failed to setup speech listener");
      }
    };

    setupEventListener();

    return () => {
      if (speechUnlisten) speechUnlisten();
    };
  }, [
    capturing,
    selectedSttProvider,
    allSttProviders,
    conversation.messages.length,
  ]);

  // Context management functions
  const saveContextSettings = useCallback(
    (usePrompt: boolean, content: string) => {
      try {
        const contextSettings = {
          useSystemPrompt: usePrompt,
          contextContent: content,
        };
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT,
          JSON.stringify(contextSettings)
        );
      } catch (error) {
        console.error("Failed to save context settings:", error);
      }
    },
    []
  );

  const updateUseSystemPrompt = useCallback(
    (value: boolean) => {
      setUseSystemPrompt(value);
      saveContextSettings(value, contextContent);
    },
    [contextContent, saveContextSettings]
  );

  const updateContextContent = useCallback(
    (content: string) => {
      setContextContent(content);
      saveContextSettings(useSystemPrompt, content);
    },
    [useSystemPrompt, saveContextSettings]
  );

  // Quick actions management
  const saveQuickActions = useCallback((actions: string[]) => {
    try {
      safeLocalStorage.setItem(
        STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS,
        JSON.stringify(actions)
      );
    } catch (error) {
      console.error("Failed to save quick actions:", error);
    }
  }, []);

  const addQuickAction = useCallback(
    (action: string) => {
      if (action && !quickActions.includes(action)) {
        const newActions = [...quickActions, action];
        setQuickActions(newActions);
        saveQuickActions(newActions);
      }
    },
    [quickActions, saveQuickActions]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      const newActions = quickActions.filter((a) => a !== action);
      setQuickActions(newActions);
      saveQuickActions(newActions);
    },
    [quickActions, saveQuickActions]
  );

  const handleQuickActionClick = async (action: string) => {
    setError("");

    const effectivePrompt = buildEffectiveSystemPrompt();

    // Include the most recent transcription in conversation history if it exists
    let updatedMessages = [...conversation.messages];

    if (lastTranscription && lastTranscription.trim()) {
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      // Only add if it's not already the last message
      if (!lastMessage || lastMessage.content !== lastTranscription) {
        const timestamp = Date.now();
        const userMessage = {
          id: generateMessageId("user", timestamp),
          role: "user" as const,
          content: lastTranscription,
          timestamp,
        };
        updatedMessages.push(userMessage);

        // Update conversation state with the latest transcription
        setConversation((prev) => ({
          ...prev,
          messages: [userMessage, ...prev.messages],
          updatedAt: timestamp,
          title: prev.title || generateConversationTitle(lastTranscription),
        }));
      }
    }

    const previousMessages = updatedMessages.map((msg) => {
      return { role: msg.role, content: msg.content };
    });

    await processWithAI(action, effectivePrompt.text, previousMessages, effectivePrompt.segments);
  };

  /** Regenerates the most recent AI response at a different response length (Phase F, ported from useCompletion). */
  const regenerate = useCallback(
    async (lengthId: string) => {
      if (!lastTranscription || !lastAIResponse) return;
      if (isAIProcessing) return;

      if (!selectedAIProvider.provider) {
        setError("No AI provider selected.");
        return;
      }
      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider) {
        setError("AI provider config not found.");
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const prevResponse = lastAIResponse;
      setIsAIProcessing(true);
      setError("");
      setLastAIResponse("");

      try {
        const effectivePrompt = buildEffectiveSystemPrompt();
        const failoverEnabled = getFailoverEnabled();
        const failoverChain = failoverEnabled
          ? [
              { provider, variables: providerVariables[provider.id || ""] || {} },
              ...getFailoverChain()
                .filter((id) => id !== selectedAIProvider.provider)
                .map((id) => allAiProviders.find((p) => p.id === id))
                .filter((p): p is NonNullable<typeof p> => p != null)
                .map((p) => ({ provider: p, variables: providerVariables[p.id || ""] || {} })),
            ]
          : undefined;

        // conversation.messages is newest-first (prepended); the most recent
        // turn is [user, assistant, ...older] — drop it so the model doesn't see the question twice.
        const history = conversation.messages
          .slice(2)
          .map((msg) => ({ role: msg.role, content: msg.content }));

        let fullResponse = "";
        for await (const chunk of fetchAIResponseWithFailover({
          provider,
          selectedProvider: selectedAIProvider,
          failoverChain,
          systemPrompt: effectivePrompt.text,
          segments: effectivePrompt.segments,
          history,
          userMessage: lastTranscription,
          imagesBase64: [],
          signal,
          _source: "audio",
          responseLengthOverride: lengthId,
        })) {
          if (signal.aborted) return;
          fullResponse += chunk;
          setLastAIResponse((prev) => prev + chunk);
        }

        if (signal.aborted) return;

        if (fullResponse) {
          setConversation((prev) => {
            const messages = [...prev.messages];
            const idx = messages.findIndex((m) => m.role === "assistant");
            if (idx !== -1) {
              messages[idx] = { ...messages[idx], content: fullResponse, timestamp: Date.now() };
            }
            return { ...prev, messages, updatedAt: Date.now() };
          });
        }
      } catch (aiError: any) {
        if (!signal.aborted) {
          setError(aiError.message || "Regeneration failed");
          setLastAIResponse(prevResponse);
        }
      } finally {
        setIsAIProcessing(false);
      }
    },
    [
      lastTranscription,
      lastAIResponse,
      isAIProcessing,
      selectedAIProvider,
      allAiProviders,
      providerVariables,
      conversation.messages,
      buildEffectiveSystemPrompt,
    ]
  );

  // Start continuous recording manually
  const startContinuousRecording = useCallback(async () => {
    try {
      setRecordingProgress(0);
      setError("");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start a new continuous recording session
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      console.error("Failed to start continuous recording:", err);
      setError(`Failed to start recording: ${err}`);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  // Ignore current recording (stop without transcription)
  const ignoreContinuousRecording = useCallback(async () => {
    try {
      if (!isContinuousMode || !isRecordingInContinuousMode) return;

      // Stop the capture without processing
      await invoke<string>("stop_system_audio_capture");

      // Reset states
      setRecordingProgress(0);
      setIsProcessing(false);
      setIsRecordingInContinuousMode(false);
    } catch (err) {
      console.error("Failed to ignore recording:", err);
      setError(`Failed to ignore recording: ${err}`);
    }
  }, [isContinuousMode, isRecordingInContinuousMode]);

  // AI Processing function
  const processWithAI = useCallback(
    async (
      transcription: string,
      prompt: string,
      previousMessages: Message[],
      segments?: { name: string; text: string }[]
    ) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      try {
        setIsAIProcessing(true);
        setLastAIResponse("");
        setError("");

        let fullResponse = "";

        if (!selectedAIProvider.provider) {
          setError("No AI provider selected.");
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider) {
          setError("AI provider config not found.");
          return;
        }

        try {
          const failoverEnabled = getFailoverEnabled();
          const failoverChain = failoverEnabled
            ? [
                { provider, variables: providerVariables[provider.id || ""] || {} },
                ...getFailoverChain()
                  .filter((id) => id !== selectedAIProvider.provider)
                  .map((id) => allAiProviders.find((p) => p.id === id))
                  .filter((p): p is NonNullable<typeof p> => p != null)
                  .map((p) => ({ provider: p, variables: providerVariables[p.id || ""] || {} })),
              ]
            : undefined;
          for await (const chunk of fetchAIResponseWithFailover({
            provider: provider,
            selectedProvider: selectedAIProvider,
            failoverChain: failoverChain,
            systemPrompt: prompt,
            segments,
            history: previousMessages,
            userMessage: transcription,
            imagesBase64: [],
            _source: "audio",
          })) {
            fullResponse += chunk;
            setLastAIResponse((prev) => prev + chunk);
          }
        } catch (aiError: any) {
          setError(aiError.message || "Failed to get AI response");
        }

        if (fullResponse) {
          const timestamp = Date.now();
          setConversation((prev) => ({
            ...prev,
            messages: [
              {
                id: generateMessageId("user", timestamp),
                role: "user" as const,
                content: transcription,
                timestamp,
              },
              {
                id: generateMessageId("assistant", timestamp + 1),
                role: "assistant" as const,
                content: fullResponse,
                timestamp: timestamp + 1,
              },
              ...prev.messages,
            ],
            updatedAt: timestamp,
            title: prev.title || generateConversationTitle(transcription),
          }));
        }
      } catch (err) {
        setError("Failed to get AI response");
      } finally {
        setIsAIProcessing(false);
        // No auto-restart - user manually controls when to start next recording
      }
    },
    [selectedAIProvider, allAiProviders, conversation.messages]
  );

  /** Fire the interview transcript buffer: flush chunk, assemble, call AI. */
  const fireInterviewBuffer = useCallback(async () => {
    if (captureMode !== "interview") return;
    if (isFireProcessing || isAIProcessing) return;

    // Check if there's anything in the buffer
    if (!interviewBufferText.trim()) {
      setError("Nothing captured yet");
      return;
    }

    setIsFireProcessing(true);
    setError("");

    try {
      // Step 1: flush the current partial chunk from Rust
      try {
        await invoke("flush_interview_chunk");
      } catch {
        // Non-fatal — continue with what we have
      }

      // Step 2: wait briefly for the flush chunk's transcription to arrive
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Step 3: gather latest buffer text
      const questionText = interviewBufferText.trim();
      if (!questionText) {
        setError("Nothing captured yet");
        setIsFireProcessing(false);
        return;
      }

      // Step 4: clear the buffer immediately
      setInterviewChunks([]);
      setInterviewBufferText("");

      // Step 5: set lastTranscription (keeps regenerate() working)
      setLastTranscription(questionText);

      // Step 6: call AI
      const effectivePrompt = buildEffectiveSystemPrompt();
      const previousMessages = conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      await processWithAI(
        questionText,
        effectivePrompt.text,
        previousMessages,
        effectivePrompt.segments
      );
    } catch (err: any) {
      setError(err.message || "Failed to fire interview answer");
    } finally {
      setIsFireProcessing(false);
    }
  }, [
    captureMode,
    interviewBufferText,
    isFireProcessing,
    isAIProcessing,
    buildEffectiveSystemPrompt,
    conversation.messages,
    processWithAI,
  ]);

  /** Clear the interview transcript buffer without firing. */
  const clearInterviewBuffer = useCallback(() => {
    setInterviewChunks([]);
    setInterviewBufferText("");
    setSttQueueWarning("");
  }, []);

  const startCapture = useCallback(async () => {
    try {
      setError("");

      if (captureMode === "interview") {
        // Start interview capture
        const hasAccess = await invoke<boolean>("check_system_audio_access");
        if (!hasAccess) {
          setSetupRequired(true);
          setIsPopoverOpen(true);
          return;
        }

        const deviceId =
          selectedAudioDevices.output.id !== "default"
            ? selectedAudioDevices.output.id
            : null;

        setInterviewChunks([]);
        setInterviewBufferText("");
        setSttQueueWarning("");
        setInterviewCapturing(true);
        setIsPopoverOpen(true);

        await invoke<string>("start_interview_capture", {
          deviceId: deviceId,
        });
        return;
      }

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const isContinuous = !vadConfig.enabled;

      // Set up conversation
      const conversationId = generateConversationId("sysaudio");
      setConversation({
        id: conversationId,
        title: "",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      });

      setCapturing(true);
      setIsPopoverOpen(true);
      setIsContinuousMode(isContinuous);
      setRecordingProgress(0);

      // If continuous mode
      if (isContinuous) {
        setIsRecordingInContinuousMode(false);
        return;
      }

      // VAD mode: Start recording immediately
      // Stop any existing capture
      await invoke<string>("stop_system_audio_capture");

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      // Start capture with VAD config
      await invoke<string>("start_system_audio_capture", {
        vadConfig: vadConfig,
        deviceId: deviceId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setIsPopoverOpen(true);
    }
  }, [vadConfig, selectedAudioDevices.output.id]);

  const stopCapture = useCallback(async () => {
    try {
      // Abort any ongoing AI requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      if (captureMode === "interview") {
        // Stop interview capture
        try {
          await invoke<string>("stop_interview_capture");
        } catch {
          // ignore if not running
        }
        setInterviewCapturing(false);
        setInterviewChunks([]);
        setInterviewBufferText("");
        setSttQueueWarning("");
      } else {
        // Stop the audio capture
        await invoke<string>("stop_system_audio_capture");
      }

      // Reset states
      setCapturing(false);
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsContinuousMode(false);
      setIsRecordingInContinuousMode(false);
      setRecordingProgress(0);
      setLastTranscription("");
      setLastAIResponse("");
      setError("");
      setIsPopoverOpen(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to stop capture: ${errorMessage}`);
      console.error("Stop capture error:", err);
    }
  }, [captureMode]);

  // Manual stop for continuous recording
  const manualStopAndSend = useCallback(async () => {
    try {
      if (!isContinuousMode) {
        console.warn("Not in continuous mode");
        return;
      }

      // Show processing state immediately
      setIsProcessing(true);

      // Trigger manual stop event
      await invoke("manual_stop_continuous");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to manually stop: ${errorMessage}`);
      setIsProcessing(false); // Clear processing state on error
      console.error("Manual stop error:", err);
    }
  }, [isContinuousMode]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();

      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      // Delay to give the user time to grant permissions in the system dialog.
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please try the manual steps.");
      }
    } catch (err) {
      setError("Failed to request access. Please try the manual steps below.");
      setSetupRequired(true);
    }
  }, [startCapture]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing ||
      interviewCapturing ||
      setupRequired ||
      isAIProcessing ||
      isFireProcessing ||
      !!lastAIResponse ||
      !!error ||
      (captureMode === "interview" && !!interviewBufferText);
    setIsPopoverOpen(shouldOpenPopover);
    resizeWindow(shouldOpenPopover);
  }, [
    capturing,
    setupRequired,
    isAIProcessing,
    lastAIResponse,
    error,
    resizeWindow,
  ]);

  useEffect(() => {
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (capturing) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });
  }, [startCapture, stopCapture]);

  // Register interview_fire custom shortcut
  useEffect(() => {
    if (captureMode !== "interview") return;
    globalShortcuts.registerCustomShortcutCallback("interview_fire", () => {
      fireInterviewBuffer();
    });
    return () => {
      globalShortcuts.unregisterCustomShortcutCallback("interview_fire");
    };
  }, [captureMode, fireInterviewBuffer, globalShortcuts]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      invoke("stop_system_audio_capture").catch(() => {});
      invoke("stop_interview_capture").catch(() => {});
    };
  }, []);

  // Debounced save to prevent race conditions and improve performance
  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Only debounce if there are messages to save
    if (
      !conversation.id ||
      conversation.updatedAt === 0 ||
      conversation.messages.length === 0
    ) {
      return;
    }

    // Debounce saves (only save 500ms after last change)
    saveTimeoutRef.current = setTimeout(async () => {
      // Don't save if already saving (prevent concurrent saves)
      if (isSavingRef.current) {
        return;
      }

      try {
        isSavingRef.current = true;
        await saveConversation(conversation);
      } catch (error) {
        console.error("Failed to save system audio conversation:", error);
      } finally {
        isSavingRef.current = false;
      }
    }, CONVERSATION_SAVE_DEBOUNCE_MS);

    // Cleanup on unmount or dependency change
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    conversation.messages.length,
    conversation.title,
    conversation.id,
    conversation.updatedAt,
  ]);

  const startNewConversation = useCallback(() => {
    setConversation({
      id: generateConversationId("sysaudio"),
      title: "",
      messages: [],
      createdAt: 0,
      updatedAt: 0,
    });
    setLastTranscription("");
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setIsPopoverOpen(false);
    setUseSystemPrompt(true);
  }, []);

  // Update VAD configuration
  const updateVadConfiguration = useCallback(async (config: VadConfig) => {
    try {
      setVadConfig(config);
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      await invoke("update_vad_config", { config });
    } catch (error) {
      console.error("Failed to update VAD config:", error);
    }
  }, []);

  useEffect(() => {
    if (capturing) {
      setIsContinuousMode(!vadConfig.enabled);

      if (!vadConfig.enabled) {
        setIsRecordingInContinuousMode(false);
      }
    }
  }, [vadConfig.enabled, capturing]);

  // Keyboard arrow key support for scrolling (local shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const scrollElement = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement;

      if (!scrollElement) return;

      const scrollAmount = 100; // pixels to scroll

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollElement.scrollBy({ top: scrollAmount, behavior: "smooth" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollElement.scrollBy({ top: -scrollAmount, behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopoverOpen]);

  // Keyboard shortcuts for continuous mode recording (local shortcuts)
  useEffect(() => {
    const handleRecordingShortcuts = (e: KeyboardEvent) => {
      if (!isPopoverOpen || !isContinuousMode) return;
      if (isProcessing || isAIProcessing) return;

      // Enter: Start recording (when not recording) or Stop & Send (when recording)
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (!isRecordingInContinuousMode) {
          startContinuousRecording();
        } else {
          manualStopAndSend();
        }
      }

      // Escape: Ignore recording (when recording)
      if (e.key === "Escape" && isRecordingInContinuousMode) {
        e.preventDefault();
        ignoreContinuousRecording();
      }

      // Space: Start recording (when not recording) - only if not typing in input
      if (
        e.key === " " &&
        !isRecordingInContinuousMode &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        startContinuousRecording();
      }
    };

    window.addEventListener("keydown", handleRecordingShortcuts);
    return () =>
      window.removeEventListener("keydown", handleRecordingShortcuts);
  }, [
    isPopoverOpen,
    isContinuousMode,
    isRecordingInContinuousMode,
    isProcessing,
    isAIProcessing,
    startContinuousRecording,
    manualStopAndSend,
    ignoreContinuousRecording,
  ]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    lastTranscription,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    // Conversation management
    conversation,
    setConversation,
    // AI processing
    processWithAI,
    // Context management
    useSystemPrompt,
    setUseSystemPrompt: updateUseSystemPrompt,
    contextContent,
    setContextContent: updateContextContent,
    startNewConversation,
    // Window resize
    resizeWindow,
    updateOverlayWindowSize,
    quickActions,
    addQuickAction,
    removeQuickAction,
    isManagingQuickActions,
    setIsManagingQuickActions,
    showQuickActions,
    setShowQuickActions,
    handleQuickActionClick,
    regenerate,
    // VAD configuration
    vadConfig,
    updateVadConfiguration,
    // Continuous recording
    isContinuousMode,
    isRecordingInContinuousMode,
    recordingProgress,
    manualStopAndSend,
    startContinuousRecording,
    ignoreContinuousRecording,
    // Scroll area ref for keyboard navigation
    scrollAreaRef,
    // Interview mode
    captureMode,
    setCaptureMode: handleCaptureModeChange,
    interviewChunks,
    interviewBufferText,
    interviewCapturing,
    isFireProcessing,
    sttQueueWarning,
    fireInterviewBuffer,
    clearInterviewBuffer,
    useCopilotPrompt,
    setUseCopilotPrompt,
  };
}
