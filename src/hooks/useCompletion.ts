import { useState, useCallback, useRef, useEffect } from "react";
import { useWindowResize } from "./useWindow";
import { useGlobalShortcuts } from "@/hooks";
import {
  MAX_FILES,
  CONVERSATION_ATTACH_EVENT,
  CONVERSATION_DELETED_EVENT,
} from "@/config";
import { useApp } from "@/contexts";
import {
  fetchAIResponseWithFailover,
  getFailoverEnabled,
  getFailoverChain,
  saveConversation,
  getConversationById,
  generateConversationTitle,
  MESSAGE_ID_OFFSET,
  generateConversationId,
  generateMessageId,
  generateRequestId,
  getResponseSettings,
  getProfileById,
  buildProfileKnowledgeContext,
  buildProfileBriefContext,
  loadProfileRefConvTexts,
} from "@/lib";
import { InterviewProfile } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Types for completion
interface AttachedFile {
  id: string;
  name: string;
  type: string;
  base64: string;
  size: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface CompletionState {
  input: string;
  response: string;
  isLoading: boolean;
  error: string | null;
  attachedFiles: AttachedFile[];
  currentConversationId: string | null;
  conversationHistory: ChatMessage[];
}

export const useCompletion = () => {
  const {
    selectedAIProvider,
    allAiProviders,
    providerVariables,
    systemPrompt,
    screenshotConfiguration,
    setScreenshotConfiguration,
    activeProfileId,
  } = useApp();
  const globalShortcuts = useGlobalShortcuts();

  // Cache loaded profile and its ref-conv texts so we don't re-fetch every keystroke
  const activeProfileRef = useRef<InterviewProfile | null>(null);
  const profileContextRef = useRef<string>("");
  const profileBriefRef = useRef<string>("");

  const [state, setState] = useState<CompletionState>({
    input: "",
    response: "",
    isLoading: false,
    error: null,
    attachedFiles: [],
    currentConversationId: null,
    conversationHistory: [],
  });
  // Synchronous mirror of state.currentConversationId. The cross-window
  // delete listener registers once and must compare against the *current*
  // id, not the one captured when it was registered.
  // Synchronous re-entrancy guard for regenerate().
  const isRegeneratingRef = useRef(false);
  // Synchronous mirrors of the conversation identity. These are the source of
  // truth for saveCurrentConversation (which claims them before awaiting) and
  // for the cross-window delete listener (registered once, so it must not read
  // a captured value).
  const currentConversationIdRef = useRef<string | null>(null);
  const conversationHistoryRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    currentConversationIdRef.current = state.currentConversationId;
  }, [state.currentConversationId]);
  useEffect(() => {
    conversationHistoryRef.current = state.conversationHistory;
  }, [state.conversationHistory]);

  const [micOpen, setMicOpen] = useState(false);
  const [enableVAD, setEnableVAD] = useState(false);
  const [messageHistoryOpen, setMessageHistoryOpen] = useState(false);
  const [isFilesPopoverOpen, setIsFilesPopoverOpen] = useState(false);
  const [isScreenshotLoading, setIsScreenshotLoading] = useState(false);
  const [keepEngaged, setKeepEngaged] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isProcessingScreenshotRef = useRef(false);
  const screenshotConfigRef = useRef(screenshotConfiguration);
  const hasCheckedPermissionRef = useRef(false);
  const screenshotInitiatedByThisContext = useRef(false);

  const { resizeWindow } = useWindowResize();

  /** Builds the effective system prompt, prepending profile knowledge context when a profile is active.
   *  When useFullContext is true, sends the full resume/JD/docs (used by prompt caching).
   *  Default (false) sends the compact AI-generated brief. Falls back to full context if brief is empty.
   *  Returns { text, segments } for capture instrumentation. */
  const buildEffectiveSystemPrompt = useCallback(
    (useFullContext = false): { text: string; segments: { name: string; text: string }[] } | undefined => {
      const base = systemPrompt || undefined;
      const profileCtx = useFullContext
        ? profileContextRef.current
        : profileBriefRef.current || profileContextRef.current;
      if (!profileCtx) {
        if (!base) return undefined;
        return { text: base, segments: [{ name: "base", text: base }] };
      }
      const text = base ? `${profileCtx}\n\n---\n\n${base}` : profileCtx;
      const segments: { name: string; text: string }[] = [];
      segments.push({ name: "profileContext", text: profileCtx });
      if (base) segments.push({ name: "base", text: base });
      return { text, segments };
    },
    [systemPrompt]
  );

  useEffect(() => {
    screenshotConfigRef.current = screenshotConfiguration;
  }, [screenshotConfiguration]);

  // Reload the active profile and build its knowledge context whenever activeProfileId changes
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

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  // Stash for regenerate (Phase F)
  const lastUserMessageRef = useRef<string>("");
  const lastImagesRef = useRef<string[]>([]);

  const setInput = useCallback((value: string) => {
    setState((prev) => ({ ...prev, input: value }));
  }, []);

  const setResponse = useCallback((value: string) => {
    setState((prev) => ({ ...prev, response: value }));
  }, []);

  const addFile = useCallback(async (file: File) => {
    try {
      const base64 = await fileToBase64(file);
      const attachedFile: AttachedFile = {
        id: Date.now().toString(),
        name: file.name,
        type: file.type,
        base64,
        size: file.size,
      };

      setState((prev) => ({
        ...prev,
        attachedFiles: [...prev.attachedFiles, attachedFile],
      }));
    } catch (error) {
      console.error("Failed to process file:", error);
    }
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setState((prev) => ({
      ...prev,
      attachedFiles: prev.attachedFiles.filter((f) => f.id !== fileId),
    }));
  }, []);

  const clearFiles = useCallback(() => {
    setState((prev) => ({ ...prev, attachedFiles: [] }));
  }, []);

  const submit = useCallback(
    async (speechText?: string) => {
      const input = speechText || state.input;

      if (!input.trim()) {
        return;
      }

      if (speechText) {
        setState((prev) => ({
          ...prev,
          input: speechText,
        }));
      }

      // Generate unique request ID
      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      // Cancel any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // Prepare message history for the AI (cap to last 6 messages for context efficiency)
        const MAX_HISTORY_MESSAGES = 6;
        const messageHistory = state.conversationHistory
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
          }))
          .slice(-MAX_HISTORY_MESSAGES);

        // Handle image attachments
        const imagesBase64: string[] = [];
        if (state.attachedFiles.length > 0) {
          state.attachedFiles.forEach((file) => {
            if (file.type.startsWith("image/")) {
              imagesBase64.push(file.base64);
            }
          });
        }

        let fullResponse = "";

        // Check if AI provider is configured
        if (!selectedAIProvider.provider) {
          setState((prev) => ({
            ...prev,
            error: "Please select an AI provider in settings",
          }));
          return;
        }

        const provider = allAiProviders.find(
          (p) => p.id === selectedAIProvider.provider
        );
        if (!provider) {
          setState((prev) => ({
            ...prev,
            error: "Invalid provider selected",
          }));
          return;
        }

        // Clear previous response and set loading state
        setState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          response: "",
        }));

        try {
          // For Anthropic-with-caching, default to full context mode (the brief is below the cache floor)
          const FULL_CONTEXT_MODE = selectedAIProvider.provider === "claude";
          const effectivePrompt = buildEffectiveSystemPrompt(FULL_CONTEXT_MODE);
          // Build failover chain: primary first, then any configured fallback providers
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
          // Use the fetchAIResponse function with signal (with optional failover)
          for await (const chunk of fetchAIResponseWithFailover({
            provider: provider,
            selectedProvider: selectedAIProvider,
            failoverChain: failoverChain,
            systemPrompt: effectivePrompt?.text,
            segments: effectivePrompt?.segments,
            history: messageHistory,
            userMessage: input,
            imagesBase64,
            signal,
            _source: "overlay",
          })) {
            // Only update if this is still the current request
            if (currentRequestIdRef.current !== requestId) {
              return; // Request was superseded, stop processing
            }

            // Check if request was aborted
            if (signal.aborted) {
              return; // Request was cancelled, stop processing
            }

            fullResponse += chunk;
            setState((prev) => ({
              ...prev,
              response: prev.response + chunk,
            }));
          }
        } catch (e: any) {
          // Only show error if this is still the current request and not aborted
          if (currentRequestIdRef.current === requestId && !signal.aborted) {
            setState((prev) => ({
              ...prev,
              isLoading: false,
              error: e.message || "An error occurred",
            }));
          }
          return;
        }

        // Only proceed if this is still the current request
        if (currentRequestIdRef.current !== requestId || signal.aborted) {
          return;
        }

        setState((prev) => ({ ...prev, isLoading: false }));

        // Focus input after AI response is complete
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        // Save the conversation after successful completion
        if (fullResponse) {
          await saveCurrentConversation(
            input,
            fullResponse,
            state.attachedFiles
          );
          // Stash last question for regenerate (Phase F)
          lastUserMessageRef.current = input;
          lastImagesRef.current = imagesBase64;
          // Clear input and attached files after saving
          setState((prev) => ({
            ...prev,
            input: "",
            attachedFiles: [],
          }));
        }
      } catch (error) {
        // Only show error if not aborted
        if (!signal?.aborted && currentRequestIdRef.current === requestId) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "An error occurred",
            isLoading: false,
          }));
        }
      }
    },
    [
      state.input,
      state.attachedFiles,
      selectedAIProvider,
      allAiProviders,
      // Used when building the failover chain. Typing normally refreshes this
      // closure via state.input, so the gap only showed on the voice path:
      // rotate a fallback provider's key, submit by speech without touching
      // the input box, and the old key was still used.
      providerVariables,
      systemPrompt,
      state.conversationHistory,
      buildEffectiveSystemPrompt,
    ]
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    currentRequestIdRef.current = null;
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  const regenerate = useCallback(
    async (lengthId: string) => {
      const lastMsg = lastUserMessageRef.current;
      if (!lastMsg || !state.response) return;
      // Ref, not state: two clicks landing in the same render both read the
      // pre-update state.isLoading and both fired a real (billed) request,
      // with the first one's partial text flickering into the panel before the
      // second aborted it.
      if (isRegeneratingRef.current || state.isLoading) return;
      isRegeneratingRef.current = true;

      // Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      const requestId = generateRequestId();
      currentRequestIdRef.current = requestId;

      const provider = allAiProviders.find(
        (p) => p.id === selectedAIProvider.provider
      );
      if (!provider) {
        // Release the guard on this early exit too, or regenerate stays
        // permanently wedged after one misconfigured attempt.
        isRegeneratingRef.current = false;
        return;
      }

      const prevResponse = state.response;
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        response: "",
      }));

      try {
        const FULL_CONTEXT_MODE = selectedAIProvider.provider === "claude";
        const effectivePrompt = buildEffectiveSystemPrompt(FULL_CONTEXT_MODE);
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

        let fullResponse = "";
        for await (const chunk of fetchAIResponseWithFailover({
          provider,
          selectedProvider: selectedAIProvider,
          failoverChain,
          systemPrompt: effectivePrompt?.text,
          segments: effectivePrompt?.segments,
          // Strip the trailing turn so the model doesn't see Q twice
          history: (() => {
            const trimmed = [...state.conversationHistory];
            if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "assistant") trimmed.pop();
            if (trimmed.length > 0 && trimmed[trimmed.length - 1].role === "user") trimmed.pop();
            return trimmed
              .map((msg: any) => ({ role: msg.role, content: msg.content }))
              .slice(-6);
          })(),
          userMessage: lastMsg,
          imagesBase64: lastImagesRef.current,
          signal,
          _source: "overlay",
          responseLengthOverride: lengthId,
        })) {
          if (currentRequestIdRef.current !== requestId || signal.aborted) return;
          fullResponse += chunk;
          setState((prev) => ({ ...prev, response: prev.response + chunk }));
        }

        if (currentRequestIdRef.current !== requestId || signal.aborted) return;
        setState((prev) => ({ ...prev, isLoading: false }));

        if (fullResponse) {
          // Update the last assistant message in-place (replace, not append)
          setState((prev) => {
            const history = [...prev.conversationHistory];
            // Find the last assistant message and replace its content
            for (let i = history.length - 1; i >= 0; i--) {
              if (history[i].role === "assistant") {
                history[i] = { ...history[i], content: fullResponse, timestamp: Date.now() };
                break;
              }
            }
            return { ...prev, conversationHistory: history };
          });
          // Persist the updated conversation
          const conversationId = state.currentConversationId;
          if (conversationId) {
            try {
              const { getConversationById, saveConversation } = await import("@/lib");
              const existing = await getConversationById(conversationId);
              if (existing) {
                const messages = [...existing.messages];
                for (let i = messages.length - 1; i >= 0; i--) {
                  if (messages[i].role === "assistant") {
                    messages[i] = { ...messages[i], content: fullResponse, timestamp: Date.now() };
                    break;
                  }
                }
                await saveConversation({ ...existing, messages, updatedAt: Date.now() });
              }
            } catch {
              // Non-critical — the in-memory state is already updated
            }
          }
        }
      } catch (e: any) {
        if (currentRequestIdRef.current === requestId && !signal.aborted) {
          // Restore previous response on failure
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: e.message || "Regeneration failed",
            response: prev.response || prevResponse,
          }));
        }
      } finally {
        isRegeneratingRef.current = false;
      }
    },
    [
      state.response,
      state.isLoading,
      state.currentConversationId,
      state.conversationHistory,
      selectedAIProvider,
      allAiProviders,
      providerVariables,
      buildEffectiveSystemPrompt,
    ]
  );

  const reset = useCallback(() => {
    // Don't reset if keep engaged mode is active
    if (keepEngaged) {
      return;
    }
    cancel();
    setState((prev) => ({
      ...prev,
      input: "",
      response: "",
      error: null,
      attachedFiles: [],
    }));
  }, [cancel, keepEngaged]);

  // Helper function to convert file to base64
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string)?.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = reject;
    });
  }, []);

  // Note: saveConversation, getConversationById, and generateConversationTitle
  // are now imported from lib/database/chat-history.action.ts

  const loadConversation = useCallback((conversation: ChatConversation) => {
    // Keep the synchronous mirrors in step — see startNewConversation.
    currentConversationIdRef.current = conversation.id;
    conversationHistoryRef.current = conversation.messages;
    setState((prev) => ({
      ...prev,
      currentConversationId: conversation.id,
      conversationHistory: conversation.messages,
      input: "",
      response: "",
      error: null,
      isLoading: false,
    }));
  }, []);

  const startNewConversation = useCallback(() => {
    // Reset the refs synchronously too — the effects that mirror state into
    // them only run after the next render, and saveCurrentConversation reads
    // the refs.
    currentConversationIdRef.current = null;
    conversationHistoryRef.current = [];
    setState((prev) => ({
      ...prev,
      currentConversationId: null,
      conversationHistory: [],
      input: "",
      response: "",
      error: null,
      isLoading: false,
      attachedFiles: [],
    }));
  }, []);

  const saveCurrentConversation = useCallback(
    async (
      userMessage: string,
      assistantResponse: string,
      _attachedFiles: AttachedFile[]
    ) => {
      // Validate inputs
      if (!userMessage || !assistantResponse) {
        console.error("Cannot save conversation: missing message content");
        return;
      }

      // Read from refs, not state. This function awaits a DB write before its
      // setState commits, so a second submit starting inside that window used
      // to see currentConversationId === null and conversationHistory === []
      // from its own stale closure — minting a *second* conversation holding
      // only turn 2 and orphaning turn 1. Two half-conversations for one
      // session.
      const priorConversationId = currentConversationIdRef.current;
      const conversationId = priorConversationId || generateConversationId("chat");
      const timestamp = Date.now();

      const userMsg: ChatMessage = {
        id: generateMessageId("user", timestamp),
        role: "user",
        content: userMessage,
        timestamp,
      };

      const assistantMsg: ChatMessage = {
        id: generateMessageId("assistant", timestamp + MESSAGE_ID_OFFSET),
        role: "assistant",
        content: assistantResponse,
        timestamp: timestamp + MESSAGE_ID_OFFSET,
      };

      const priorHistory = conversationHistoryRef.current;
      const newMessages = [...priorHistory, userMsg, assistantMsg];

      // Claim the id and history synchronously, before any await, so a
      // concurrent submit appends to this conversation instead of starting
      // its own.
      currentConversationIdRef.current = conversationId;
      conversationHistoryRef.current = newMessages;

      // Get existing conversation if updating
      let existingConversation = null;
      if (priorConversationId) {
        try {
          existingConversation = await getConversationById(priorConversationId);
        } catch (error) {
          console.error("Failed to get existing conversation:", error);
        }
      }

      const title =
        priorHistory.length === 0
          ? generateConversationTitle(userMessage)
          : existingConversation?.title ||
            generateConversationTitle(userMessage);

      const conversation: ChatConversation = {
        id: conversationId,
        title,
        messages: newMessages,
        createdAt: existingConversation?.createdAt || timestamp,
        updatedAt: timestamp,
      };

      try {
        await saveConversation(conversation);

        setState((prev) => ({
          ...prev,
          currentConversationId: conversationId,
          conversationHistory: newMessages,
        }));
      } catch (error) {
        console.error("Failed to save conversation:", error);
        // Show error to user
        setState((prev) => ({
          ...prev,
          error: "Failed to save conversation. Please try again.",
        }));
      }
    },
    [state.currentConversationId, state.conversationHistory]
  );

  // Listen for conversation events from the main ChatHistory component
  useEffect(() => {
    const handleConversationSelected = async (event: any) => {
      console.log(event, "event");
      // Only the conversation ID is passed through the event
      const { id } = event.detail;
      console.log(id, "id");
      if (!id || typeof id !== "string") {
        console.error("No conversation ID provided");
        setState((prev) => ({
          ...prev,
          error: "Invalid conversation selected",
        }));
        return;
      }
      console.log(id, "id");
      try {
        // Fetch the full conversation from SQLite
        const conversation = await getConversationById(id);

        if (conversation) {
          loadConversation(conversation);
        } else {
          console.error(`Conversation ${id} not found in database`);
          setState((prev) => ({
            ...prev,
            error: "Conversation not found. It may have been deleted.",
          }));
        }
      } catch (error) {
        console.error("Failed to load conversation:", error);
        setState((prev) => ({
          ...prev,
          error: "Failed to load conversation. Please try again.",
        }));
      }
    };

    const handleNewConversation = () => {
      startNewConversation();
    };

    const handleConversationDeleted = (event: any) => {
      const deletedId = event.detail;
      // If the currently active conversation was deleted, start a new one
      if (state.currentConversationId === deletedId) {
        startNewConversation();
      }
    };

    // Cross-window channel. The previous `storage`-event listener here could
    // never fire: StorageEvent is not delivered between Tauri webview windows,
    // and the History view that writes it lives in a different window from
    // this overlay. Tauri listen() is the channel that actually works.
    let cancelled = false;
    let unlistenAttach: (() => void) | undefined;
    let unlistenDeleted: (() => void) | undefined;

    (async () => {
      try {
        const attachFn = await listen<{ id: string }>(
          CONVERSATION_ATTACH_EVENT,
          async (event) => {
            const id = event.payload?.id;
            if (!id || typeof id !== "string") return;
            try {
              const conversation = await getConversationById(id);
              if (conversation) loadConversation(conversation);
            } catch (error) {
              console.error("Failed to load attached conversation:", error);
            }
          }
        );
        if (cancelled) {
          attachFn();
          return;
        }
        unlistenAttach = attachFn;

        const deletedFn = await listen<{ id: string }>(
          CONVERSATION_DELETED_EVENT,
          (event) => {
            // Must react even in another window: otherwise this overlay keeps
            // the deleted id and its next save resurrects the conversation.
            if (currentConversationIdRef.current === event.payload?.id) {
              startNewConversation();
            }
          }
        );
        if (cancelled) {
          deletedFn();
          return;
        }
        unlistenDeleted = deletedFn;
      } catch (error) {
        console.error("Failed to set up conversation listeners:", error);
      }
    })();

    window.addEventListener("conversationSelected", handleConversationSelected);
    window.addEventListener("newConversation", handleNewConversation);
    window.addEventListener("conversationDeleted", handleConversationDeleted);

    return () => {
      cancelled = true;
      unlistenAttach?.();
      unlistenDeleted?.();
      window.removeEventListener(
        "conversationSelected",
        handleConversationSelected
      );
      window.removeEventListener("newConversation", handleNewConversation);
      window.removeEventListener(
        "conversationDeleted",
        handleConversationDeleted
      );
    };
  }, [loadConversation, startNewConversation, state.currentConversationId]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Uses the imported MAX_FILES. A local `const MAX_FILES = 6` used to
    // shadow it here — same value today, but a trap the moment the shared
    // constant changes.

    files.forEach((file) => {
      if (
        file.type.startsWith("image/") &&
        state.attachedFiles.length < MAX_FILES
      ) {
        addFile(file);
      }
    });

    // Reset input so same file can be selected again
    e.target.value = "";
  };

  const handleScreenshotSubmit = useCallback(
    async (base64: string, prompt?: string) => {
      // Only the manual branch stages into attachedFiles; the auto branch
      // (prompt set) passes the image straight to the request and never
      // touches that list. Applying the cap to both meant that with 6 images
      // already attached, the screenshot shortcut errored instead of working.
      if (!prompt && state.attachedFiles.length >= MAX_FILES) {
        setState((prev) => ({
          ...prev,
          error: `You can only upload ${MAX_FILES} files`,
        }));
        return;
      }

      try {
        if (prompt) {
          // Auto mode: Submit directly to AI with screenshot
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          // Generate unique request ID
          const requestId = generateRequestId();
          currentRequestIdRef.current = requestId;

          // Cancel any existing request
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }

          abortControllerRef.current = new AbortController();
          const signal = abortControllerRef.current.signal;

          try {
            // Prepare message history for the AI (cap to last 6 messages)
            const MAX_HISTORY_MESSAGES = 6;
            const messageHistory = state.conversationHistory
              .map((msg) => ({
                role: msg.role,
                content: msg.content,
              }))
              .slice(-MAX_HISTORY_MESSAGES);

            let fullResponse = "";

            // Check if AI provider is configured
            if (!selectedAIProvider.provider) {
              setState((prev) => ({
                ...prev,
                error: "Please select an AI provider in settings",
              }));
              return;
            }

            const provider = allAiProviders.find(
              (p) => p.id === selectedAIProvider.provider
            );
            if (!provider) {
              setState((prev) => ({
                ...prev,
                error: "Invalid provider selected",
              }));
              return;
            }

            // Clear previous response and set loading state
            setState((prev) => ({
              ...prev,
              input: prompt,
              isLoading: true,
              error: null,
              response: "",
            }));

            // For Anthropic-with-caching, default to full context mode (the brief is below the cache floor)
            const FULL_CONTEXT_MODE = selectedAIProvider.provider === "claude";
            const effectivePrompt = buildEffectiveSystemPrompt(FULL_CONTEXT_MODE);
            // Build failover chain: primary first, then any configured fallback providers
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
            // Use the fetchAIResponse function with image and signal (with optional failover)
            for await (const chunk of fetchAIResponseWithFailover({
              provider: provider,
              selectedProvider: selectedAIProvider,
              failoverChain: failoverChain,
              systemPrompt: effectivePrompt?.text,
              segments: effectivePrompt?.segments,
              history: messageHistory,
              userMessage: prompt,
              imagesBase64: [base64],
              signal,
              _source: "overlay",
            })) {
              // Only update if this is still the current request
              if (currentRequestIdRef.current !== requestId || signal.aborted) {
                return; // Request was superseded or cancelled
              }

              fullResponse += chunk;
              setState((prev) => ({
                ...prev,
                response: prev.response + chunk,
              }));
            }

            // Only proceed if this is still the current request
            if (currentRequestIdRef.current !== requestId || signal.aborted) {
              return;
            }

            setState((prev) => ({ ...prev, isLoading: false }));

            // Focus input after screenshot AI response is complete
            setTimeout(() => {
              inputRef.current?.focus();
            }, 100);

            // Save the conversation after successful completion
            if (fullResponse) {
              await saveCurrentConversation(prompt, fullResponse, [
                attachedFile,
              ]);
              // Stash last question for regenerate (Phase F)
              lastUserMessageRef.current = prompt || "";
              lastImagesRef.current = [base64];
              // Clear input after saving
              setState((prev) => ({
                ...prev,
                input: "",
              }));
            }
          } catch (e: any) {
            // Only show error if this is still the current request and not aborted
            if (currentRequestIdRef.current === requestId && !signal.aborted) {
              setState((prev) => ({
                ...prev,
                error: e.message || "An error occurred",
              }));
            }
          } finally {
            // Only update loading state if this is still the current request
            if (currentRequestIdRef.current === requestId && !signal.aborted) {
              setState((prev) => ({ ...prev, isLoading: false }));
            }
          }
        } else {
          // Manual mode: Add to attached files
          const attachedFile: AttachedFile = {
            id: Date.now().toString(),
            name: `screenshot_${Date.now()}.png`,
            type: "image/png",
            base64: base64,
            size: base64.length,
          };

          setState((prev) => ({
            ...prev,
            attachedFiles: [...prev.attachedFiles, attachedFile],
          }));
        }
      } catch (error) {
        console.error("Failed to process screenshot:", error);
        setState((prev) => ({
          ...prev,
          error:
            error instanceof Error
              ? error.message
              : "An error occurred processing screenshot",
          isLoading: false,
        }));
      }
    },
    [
      state.attachedFiles.length,
      state.conversationHistory,
      selectedAIProvider,
      allAiProviders,
      systemPrompt,
      saveCurrentConversation,
      inputRef,
      buildEffectiveSystemPrompt,
    ]
  );

  const onRemoveAllFiles = () => {
    clearFiles();
    setIsFilesPopoverOpen(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!state.isLoading && state.input.trim()) {
        submit();
      }
    }
  };

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      // Check if clipboard contains images
      const items = e.clipboardData?.items;
      if (!items) return;

      const hasImages = Array.from(items).some((item) =>
        item.type.startsWith("image/")
      );

      // If we have images, prevent default text pasting and process images
      if (hasImages) {
        e.preventDefault();

        const processedFiles: File[] = [];

        Array.from(items).forEach((item) => {
          if (
            item.type.startsWith("image/") &&
            state.attachedFiles.length + processedFiles.length < MAX_FILES
          ) {
            const file = item.getAsFile();
            if (file) {
              processedFiles.push(file);
            }
          }
        });

        // Process all files
        await Promise.all(processedFiles.map((file) => addFile(file)));
      }
    },
    [state.attachedFiles.length, addFile]
  );

  const isPopoverOpen =
    state.isLoading ||
    state.response !== "" ||
    state.error !== null ||
    keepEngaged;

  useEffect(() => {
    resizeWindow(
      isPopoverOpen || micOpen || messageHistoryOpen || isFilesPopoverOpen
    );
  }, [
    isPopoverOpen,
    micOpen,
    messageHistoryOpen,
    resizeWindow,
    isFilesPopoverOpen,
  ]);

  // Auto scroll to bottom when response updates
  useEffect(() => {
    const responseSettings = getResponseSettings();
    if (
      !keepEngaged &&
      state.response &&
      scrollAreaRef.current &&
      responseSettings.autoScroll
    ) {
      const scrollElement = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollElement) {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: "smooth",
        });
      }
    }
  }, [state.response, keepEngaged]);

  // Keyboard arrow key support for scrolling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPopoverOpen) return;

      const activeScrollRef = scrollAreaRef.current || scrollAreaRef.current;
      const scrollElement = activeScrollRef?.querySelector(
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
  }, [isPopoverOpen, scrollAreaRef]);

  // Keyboard shortcut for toggling keep engaged mode (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleToggleShortcut = (e: KeyboardEvent) => {
      // Only trigger when popover is open
      if (!isPopoverOpen) return;

      // Check for Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setKeepEngaged((prev) => !prev);
        // Focus the input after toggle (with delay to ensure DOM is ready)
        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);
      }
    };

    window.addEventListener("keydown", handleToggleShortcut);
    return () => window.removeEventListener("keydown", handleToggleShortcut);
  }, [isPopoverOpen]);

  const captureScreenshot = useCallback(async () => {
    if (!handleScreenshotSubmit) return;

    const config = screenshotConfigRef.current;
    screenshotInitiatedByThisContext.current = true;
    setIsScreenshotLoading(true);

    try {
      // Check screen recording permission on macOS
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac") && !hasCheckedPermissionRef.current) {
        const {
          checkScreenRecordingPermission,
          requestScreenRecordingPermission,
        } = await import("tauri-plugin-macos-permissions-api");

        const hasPermission = await checkScreenRecordingPermission();

        if (!hasPermission) {
          // Request permission
          await requestScreenRecordingPermission();

          // Wait a moment and check again
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const hasPermissionNow = await checkScreenRecordingPermission();

          if (!hasPermissionNow) {
            setState((prev) => ({
              ...prev,
              error:
                "Screen Recording permission required. Please enable it by going to System Settings > Privacy & Security > Screen & System Audio Recording. If you don't see Naukri Lelo in the list, click the '+' button to add it. If it's already listed, make sure it's enabled. Then restart the app.",
            }));
            setIsScreenshotLoading(false);
            screenshotInitiatedByThisContext.current = false;
            return;
          }
        }
        hasCheckedPermissionRef.current = true;
      }

      if (config.enabled) {
        const base64 = await invoke("capture_to_base64");

        if (config.mode === "auto") {
          // Auto mode: Submit directly to AI with the configured prompt
          await handleScreenshotSubmit(base64 as string, config.autoPrompt);
        } else if (config.mode === "manual") {
          // Manual mode: Add to attached files without prompt
          await handleScreenshotSubmit(base64 as string);
        }
        screenshotInitiatedByThisContext.current = false;
      } else {
        // Selection Mode: Open overlay to select an area
        isProcessingScreenshotRef.current = false;
        await invoke("start_screen_capture");
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: "Failed to capture screenshot. Please try again.",
      }));
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    } finally {
      if (config.enabled) {
        setIsScreenshotLoading(false);
      }
    }
  }, [handleScreenshotSubmit]);

  useEffect(() => {
    let unlisten: any;

    const setupListener = async () => {
      unlisten = await listen("captured-selection", async (event: any) => {
        if (!screenshotInitiatedByThisContext.current) {
          return;
        }

        if (isProcessingScreenshotRef.current) {
          return;
        }

        isProcessingScreenshotRef.current = true;
        const base64 = event.payload;
        const config = screenshotConfigRef.current;

        try {
          if (config.mode === "auto") {
            // Auto mode: Submit directly to AI with the configured prompt
            await handleScreenshotSubmit(base64 as string, config.autoPrompt);
          } else if (config.mode === "manual") {
            // Manual mode: Add to attached files without prompt
            await handleScreenshotSubmit(base64 as string);
          }
        } catch (error) {
          console.error("Error processing selection:", error);
        } finally {
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          setTimeout(() => {
            isProcessingScreenshotRef.current = false;
          }, 100);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleScreenshotSubmit]);

  useEffect(() => {
    const unlisten = listen("capture-closed", () => {
      setIsScreenshotLoading(false);
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Drive both flags from a single "is voice input active?" decision rather
  // than toggling each independently. They are set separately elsewhere
  // (AutoSpeechVad sets enableVAD, the mic Popover's onOpenChange sets
  // micOpen), so they can already disagree — and toggling each in turn from
  // stale closure values could leave VAD listening and auto-submitting with
  // the mic UI closed and no visible recording indicator.
  const toggleRecording = useCallback(() => {
    setEnableVAD((prevVad) => {
      const next = !(prevVad || micOpen);
      setMicOpen(next);
      return next;
    });
  }, [micOpen]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      currentRequestIdRef.current = null;
    };
  }, []);

  // register callbacks for global shortcuts
  useEffect(() => {
    globalShortcuts.registerAudioCallback(toggleRecording);
    globalShortcuts.registerInputRef(inputRef.current);
    globalShortcuts.registerScreenshotCallback(captureScreenshot);
  }, [
    globalShortcuts.registerAudioCallback,
    globalShortcuts.registerInputRef,
    globalShortcuts.registerScreenshotCallback,
    toggleRecording,
    captureScreenshot,
    inputRef,
  ]);

  return {
    input: state.input,
    setInput,
    response: state.response,
    setResponse,
    isLoading: state.isLoading,
    error: state.error,
    attachedFiles: state.attachedFiles,
    addFile,
    removeFile,
    clearFiles,
    submit,
    cancel,
    reset,
    setState,
    enableVAD,
    setEnableVAD,
    micOpen,
    setMicOpen,
    currentConversationId: state.currentConversationId,
    conversationHistory: state.conversationHistory,
    loadConversation,
    startNewConversation,
    messageHistoryOpen,
    setMessageHistoryOpen,
    screenshotConfiguration,
    setScreenshotConfiguration,
    handleScreenshotSubmit,
    handleFileSelect,
    handleKeyPress,
    handlePaste,
    isPopoverOpen,
    scrollAreaRef,
    resizeWindow,
    isFilesPopoverOpen,
    setIsFilesPopoverOpen,
    onRemoveAllFiles,
    inputRef,
    captureScreenshot,
    isScreenshotLoading,
    keepEngaged,
    setKeepEngaged,
    regenerate,
  };
};
