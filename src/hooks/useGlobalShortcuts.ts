import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getShortcutsConfig } from "@/lib";

// Guards setupEventListeners below against running more than once per app
// lifetime. The listener registrations don't depend on component state (they
// only touch the module-level globals below), so once set up they never need
// to run again — critical because React 19 StrictMode double-invokes effects
// in dev, and the previous "check existing listener, then async re-register"
// approach raced: both invocations passed the check before either finished
// registering, producing two live Tauri subscriptions for the same event and
// double-firing every hotkey callback. This flag is set synchronously before
// any `await`, so it's safe even though the two invocations happen back to
// back — JS has no true concurrency, so the second always sees it as true.
let hasSetupEventListeners = false;

// Global singleton to prevent multiple event listeners in StrictMode
let globalEventListeners: {
  focus?: UnlistenFn;
  audio?: UnlistenFn;
  screenshot?: UnlistenFn;
  systemAudio?: UnlistenFn;
  customShortcut?: UnlistenFn;
  registrationError?: UnlistenFn;
  readAnswerKeyDown?: UnlistenFn;
  readAnswerKeyUp?: UnlistenFn;
} = {};

// Global debounce for screenshot events to prevent duplicates
let lastScreenshotEventTime = 0;

// Global callback refs
let globalInputRef: HTMLInputElement | null = null;
let globalAudioCallback: (() => void) | null = null;
let globalScreenshotCallback: (() => void | Promise<void>) | null = null;
let globalSystemAudioCallback: (() => void) | null = null;
let globalCustomShortcutCallbacks: Map<string, () => void> = new Map();
let globalReadAnswerKeyDownCallback: (() => void) | null = null;
let globalReadAnswerKeyUpCallback: (() => void) | null = null;

export const useGlobalShortcuts = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioCallbackRef = useRef<(() => void) | null>(null);
  const screenshotCallbackRef = useRef<(() => void) | null>(null);
  const systemAudioCallbackRef = useRef<(() => void) | null>(null);
  const customShortcutCallbacksRef = useRef<Map<string, () => void>>(new Map());

  const checkShortcutsRegistered = useCallback(async (): Promise<boolean> => {
    try {
      const registered = await invoke<boolean>("check_shortcuts_registered");
      return registered;
    } catch (error) {
      console.error("Failed to check shortcuts:", error);
      return false;
    }
  }, []);

  const getShortcuts = useCallback(async (): Promise<Record<
    string,
    string
  > | null> => {
    try {
      const shortcuts = await invoke<Record<string, string>>(
        "get_registered_shortcuts"
      );
      return shortcuts;
    } catch (error) {
      console.error("Failed to get shortcuts:", error);
      return null;
    }
  }, []);

  const updateShortcuts = useCallback(async (): Promise<boolean> => {
    try {
      const config = getShortcutsConfig();
      await invoke("update_shortcuts", { config });
      return true;
    } catch (error) {
      console.error("Failed to update shortcuts:", error);
      return false;
    }
  }, []);

  // Register input element for auto-focus
  const registerInputRef = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    globalInputRef = input;
  }, []);

  // Register audio callback
  const registerAudioCallback = useCallback((callback: () => void) => {
    audioCallbackRef.current = callback;
    globalAudioCallback = callback;
  }, []);

  // Register screenshot callback
  const registerScreenshotCallback = useCallback(
    (callback: () => void | Promise<void>) => {
      screenshotCallbackRef.current = callback;
      globalScreenshotCallback = callback;
    },
    []
  );

  // Register system audio callback
  const registerSystemAudioCallback = useCallback((callback: () => void) => {
    systemAudioCallbackRef.current = callback;
    globalSystemAudioCallback = callback;
  }, []);

  // Register custom shortcut callback
  const registerCustomShortcutCallback = useCallback(
    (actionId: string, callback: () => void) => {
      customShortcutCallbacksRef.current.set(actionId, callback);
      globalCustomShortcutCallbacks.set(actionId, callback);
    },
    []
  );

  // Unregister custom shortcut callback
  const unregisterCustomShortcutCallback = useCallback((actionId: string) => {
    customShortcutCallbacksRef.current.delete(actionId);
    globalCustomShortcutCallbacks.delete(actionId);
  }, []);

  // Register hold-to-read-answer key-down/key-up callbacks. These are
  // separate Tauri events (not routed through the generic custom-shortcut
  // path) because that path only ever fires on key press, never release.
  const registerReadAnswerKeyDownCallback = useCallback((callback: () => void) => {
    globalReadAnswerKeyDownCallback = callback;
  }, []);

  const registerReadAnswerKeyUpCallback = useCallback((callback: () => void) => {
    globalReadAnswerKeyUpCallback = callback;
  }, []);

  // Setup event listeners using global singleton. Guarded by
  // hasSetupEventListeners so this body — and every listen() call inside it —
  // runs at most once per app lifetime, no matter how many times this effect
  // re-fires (StrictMode double-invoke, multiple mounted consumers, etc.).
  useEffect(() => {
    if (hasSetupEventListeners) return;
    hasSetupEventListeners = true;

    const setupEventListeners = async () => {
      try {
        // Clean up any existing global listeners first
        if (globalEventListeners.focus) {
          try {
            globalEventListeners.focus();
          } catch (error) {
            console.warn("Error cleaning up focus listener:", error);
          }
        }
        if (globalEventListeners.audio) {
          try {
            globalEventListeners.audio();
          } catch (error) {
            console.warn("Error cleaning up audio listener:", error);
          }
        }
        if (globalEventListeners.screenshot) {
          try {
            globalEventListeners.screenshot();
          } catch (error) {
            console.warn("Error cleaning up screenshot listener:", error);
          }
        }
        if (globalEventListeners.systemAudio) {
          try {
            globalEventListeners.systemAudio();
          } catch (error) {
            console.warn("Error cleaning up system audio listener:", error);
          }
        }
        if (globalEventListeners.customShortcut) {
          try {
            globalEventListeners.customShortcut();
          } catch (error) {
            console.warn("Error cleaning up custom shortcut listener:", error);
          }
        }
        if (globalEventListeners.registrationError) {
          try {
            globalEventListeners.registrationError();
          } catch (error) {
            console.warn(
              "Error cleaning up shortcut registration error listener:",
              error
            );
          }
        }
        if (globalEventListeners.readAnswerKeyDown) {
          try {
            globalEventListeners.readAnswerKeyDown();
          } catch (error) {
            console.warn("Error cleaning up read-answer key-down listener:", error);
          }
        }
        if (globalEventListeners.readAnswerKeyUp) {
          try {
            globalEventListeners.readAnswerKeyUp();
          } catch (error) {
            console.warn("Error cleaning up read-answer key-up listener:", error);
          }
        }

        // Listen for focus text input event
        const unlistenFocus = await listen("focus-text-input", () => {
          setTimeout(() => {
            if (globalInputRef) {
              globalInputRef.focus();
            }
          }, 100);
        });
        globalEventListeners.focus = unlistenFocus;

        // Listen for audio recording event
        const unlistenAudio = await listen("start-audio-recording", () => {
          if (globalAudioCallback) {
            globalAudioCallback();
          }
        });
        globalEventListeners.audio = unlistenAudio;

        // Listen for screenshot trigger event with debouncing
        const unlistenScreenshot = await listen("trigger-screenshot", () => {
          const now = Date.now();
          const timeSinceLastEvent = now - lastScreenshotEventTime;

          // Debounce screenshot events (300ms minimum interval)
          if (timeSinceLastEvent < 300) {
            return;
          }

          lastScreenshotEventTime = now;

          if (globalScreenshotCallback) {
            try {
              Promise.resolve(globalScreenshotCallback())
                .catch((error) => {
                  console.error("Screenshot shortcut callback failed:", error);
                })
                .then(() => {
                  // no-op
                });
            } catch (error) {
              console.error(
                "Failed to run screenshot shortcut callback:",
                error
              );
            }
          } else {
            console.warn(
              "Screenshot shortcut triggered but no callback registered."
            );
          }
        });
        globalEventListeners.screenshot = unlistenScreenshot;

        // Listen for system audio toggle event
        const unlistenSystemAudio = await listen("toggle-system-audio", () => {
          if (globalSystemAudioCallback) {
            globalSystemAudioCallback();
          }
        });
        globalEventListeners.systemAudio = unlistenSystemAudio;

        // Listen for custom shortcut events
        const unlistenCustomShortcut = await listen<{ action: string }>(
          "custom-shortcut-triggered",
          (event) => {
            const actionId = event.payload.action;
            const callback = globalCustomShortcutCallbacks.get(actionId);
            if (callback) {
              callback();
            } else {
              console.warn(
                `No callback registered for custom shortcut: ${actionId}`
              );
            }
          }
        );
        globalEventListeners.customShortcut = unlistenCustomShortcut;

        const unlistenRegistrationError = await listen<
          Array<[string, string, string]>
        >("shortcut-registration-error", (event) => {
          window.dispatchEvent(
            new CustomEvent("shortcutRegistrationError", {
              detail: event.payload,
            })
          );
        });
        globalEventListeners.registrationError = unlistenRegistrationError;

        // Listen for the hold-to-read-answer key down/up events
        const unlistenReadAnswerKeyDown = await listen("read-answer-key-down", () => {
          globalReadAnswerKeyDownCallback?.();
        });
        globalEventListeners.readAnswerKeyDown = unlistenReadAnswerKeyDown;

        const unlistenReadAnswerKeyUp = await listen("read-answer-key-up", () => {
          globalReadAnswerKeyUpCallback?.();
        });
        globalEventListeners.readAnswerKeyUp = unlistenReadAnswerKeyUp;
      } catch (error) {
        console.error("Failed to setup event listeners:", error);
      }
    };

    setupEventListeners();
  }, []);

  // Memoized so consumers can safely list this whole object in a useEffect
  // dependency array — every field below is itself a useCallback with `[]`
  // deps, so this is stable for the lifetime of the component. Without this,
  // a fresh object every render made hotkey-registration effects that
  // depended on it tear down and re-register constantly, occasionally
  // dropping a keypress that landed in the gap.
  return useMemo(
    () => ({
      checkShortcutsRegistered,
      getShortcuts,
      updateShortcuts,
      registerInputRef,
      registerAudioCallback,
      registerScreenshotCallback,
      registerSystemAudioCallback,
      registerCustomShortcutCallback,
      unregisterCustomShortcutCallback,
      registerReadAnswerKeyDownCallback,
      registerReadAnswerKeyUpCallback,
    }),
    [
      checkShortcutsRegistered,
      getShortcuts,
      updateShortcuts,
      registerInputRef,
      registerAudioCallback,
      registerScreenshotCallback,
      registerSystemAudioCallback,
      registerCustomShortcutCallback,
      unregisterCustomShortcutCallback,
      registerReadAnswerKeyDownCallback,
      registerReadAnswerKeyUpCallback,
    ]
  );
};
