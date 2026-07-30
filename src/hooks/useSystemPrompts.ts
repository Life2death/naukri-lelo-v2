import { useCallback, useEffect, useState } from "react";
import {
  createSystemPrompt,
  getAllSystemPrompts,
  updateSystemPrompt,
  deleteSystemPrompt,
  getAppSettingWithLocalStorageFallback,
  setAppSetting,
  APP_SETTING_KEYS,
} from "@/lib/database";
import type {
  SystemPrompt,
  SystemPromptInput,
  UpdateSystemPromptInput,
} from "@/types";
import { DEFAULT_SYSTEM_PROMPT, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "@/lib";
import { useApp } from "@/contexts";

export const useSystemPrompts = () => {
  const { setSystemPrompt } = useApp();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which prompt is selected now lives in SQLite, not localStorage. The
  // prompt library was always in SQLite (so shared between a dev build and a
  // production build), but the selection was in localStorage — which the
  // webview partitions by origin, and dev (http://localhost:1420) and prod
  // (http://tauri.localhost) are different origins. The result was that both
  // builds showed the same prompts but only one of them had any selected,
  // with the other silently falling back to DEFAULT_SYSTEM_PROMPT.
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  // Load the persisted selection (adopting any pre-existing localStorage
  // value on first run) before the prompt list resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getAppSettingWithLocalStorageFallback(
        APP_SETTING_KEYS.SELECTED_SYSTEM_PROMPT_ID,
        STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID
      );
      if (cancelled || !stored) return;
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setSelectedPromptId(parsed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Fetch all system prompts from database
   */
  const fetchPrompts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getAllSystemPrompts();
      setPrompts(result);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch system prompts";
      setError(errorMessage);
      console.error("Error fetching system prompts:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create a new system prompt
   */
  const createPrompt = useCallback(
    async (input: SystemPromptInput): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await createSystemPrompt(input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to create system prompt";
        setError(errorMessage);
        console.error("Error creating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Update an existing system prompt
   */
  const updatePrompt = useCallback(
    async (
      id: number,
      input: UpdateSystemPromptInput
    ): Promise<SystemPrompt> => {
      try {
        setError(null);
        const result = await updateSystemPrompt(id, input);
        await fetchPrompts(); // Refresh list
        return result;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to update system prompt";
        setError(errorMessage);
        console.error("Error updating system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Delete a system prompt
   */
  const deletePrompt = useCallback(
    async (id: number): Promise<void> => {
      try {
        setError(null);
        await deleteSystemPrompt(id);
        await fetchPrompts(); // Refresh list
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete system prompt";
        setError(errorMessage);
        console.error("Error deleting system prompt:", err);
        throw err;
      }
    },
    [fetchPrompts]
  );

  /**
   * Refresh prompts list
   */
  const refreshPrompts = useCallback(async () => {
    await fetchPrompts();
  }, [fetchPrompts]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Fetch prompts on mount
  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  /**
   * Load selected prompt on mount and when prompts change
   */
  useEffect(() => {
    if (selectedPromptId && prompts.length > 0) {
      const selectedPrompt = prompts.find((p) => p.id === selectedPromptId);
      if (selectedPrompt) {
        setSystemPrompt(selectedPrompt.prompt);
        // Keep localStorage in step with edits to the active prompt.
        // The overlay window reads SYSTEM_PROMPT from localStorage on startup
        // and syncs live via the "storage" event, so an edit that only updates
        // the DB + in-memory state would never reach the overlay (or survive a
        // restart). Persist here too. Guard against redundant writes since the
        // storage event fires in the *other* window on every setItem.
        const storedPrompt = safeLocalStorage.getItem(
          STORAGE_KEYS.SYSTEM_PROMPT
        );
        if (storedPrompt !== selectedPrompt.prompt) {
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            selectedPrompt.prompt
          );
        }
      } else {
        // Selected prompt was deleted, reset to default
        setSelectedPromptId(null);
        void setAppSetting(APP_SETTING_KEYS.SELECTED_SYSTEM_PROMPT_ID, null);
        safeLocalStorage.removeItem(STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID);
        const currentPrompt = safeLocalStorage.getItem(
          STORAGE_KEYS.SYSTEM_PROMPT
        );
        if (!currentPrompt) {
          setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          safeLocalStorage.setItem(
            STORAGE_KEYS.SYSTEM_PROMPT,
            DEFAULT_SYSTEM_PROMPT
          );
        }
      }
    }
  }, [prompts, selectedPromptId, setSystemPrompt]);

  /**
   * Handle selecting a prompt
   */
  const handleSelectPrompt = useCallback(
    (promptId: number) => {
      const selectedPrompt = prompts.find((p) => p.id === promptId);
      if (selectedPrompt) {
        setSystemPrompt(selectedPrompt.prompt);
        setSelectedPromptId(promptId);
        // SYSTEM_PROMPT stays in localStorage: it's a per-origin cache of the
        // active prompt text that the overlay window reads at startup. The
        // *selection* is the shared source of truth and goes to SQLite.
        safeLocalStorage.setItem(
          STORAGE_KEYS.SYSTEM_PROMPT,
          selectedPrompt.prompt
        );
        void setAppSetting(
          APP_SETTING_KEYS.SELECTED_SYSTEM_PROMPT_ID,
          promptId.toString()
        );
        safeLocalStorage.setItem(
          STORAGE_KEYS.SELECTED_SYSTEM_PROMPT_ID,
          promptId.toString()
        );
        // Clear any selected Naukri Lelo prompt when user selects their own prompt
        safeLocalStorage.removeItem("selected_naukri_lelo_prompt");
      }
    },
    [prompts, setSystemPrompt]
  );

  return {
    prompts,
    isLoading,
    error,
    selectedPromptId,
    createPrompt,
    updatePrompt,
    deletePrompt,
    refreshPrompts,
    clearError,
    handleSelectPrompt,
  };
};
