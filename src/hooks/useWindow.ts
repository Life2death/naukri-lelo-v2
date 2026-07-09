import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { STORAGE_KEYS } from "@/config";
import { useCallback, useEffect } from "react";

export type OverlayPanelSize = {
  width: number;
  height: number;
};

export const OVERLAY_SIZE_LIMITS = {
  minWidth: 420,
  maxWidth: 1200,
  minHeight: 320,
  maxHeight: 900,
} as const;

export const DEFAULT_OVERLAY_PANEL_SIZE: OverlayPanelSize = {
  width: 600,
  height: 600,
};

const COLLAPSED_WINDOW_SIZE: OverlayPanelSize = {
  width: 600,
  height: 54,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeOverlayPanelSize = (
  size: Partial<OverlayPanelSize>
): OverlayPanelSize => ({
  width: clamp(
    Math.round(size.width ?? DEFAULT_OVERLAY_PANEL_SIZE.width),
    OVERLAY_SIZE_LIMITS.minWidth,
    OVERLAY_SIZE_LIMITS.maxWidth
  ),
  height: clamp(
    Math.round(size.height ?? DEFAULT_OVERLAY_PANEL_SIZE.height),
    OVERLAY_SIZE_LIMITS.minHeight,
    OVERLAY_SIZE_LIMITS.maxHeight
  ),
});

const isExpandedPanelSize = (size: OverlayPanelSize) =>
  size.width >= OVERLAY_SIZE_LIMITS.minWidth &&
  size.height >= OVERLAY_SIZE_LIMITS.minHeight;

export const getOverlayPanelSize = (): OverlayPanelSize => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.OVERLAY_PANEL_SIZE);
    if (!stored) return { ...DEFAULT_OVERLAY_PANEL_SIZE };

    return normalizeOverlayPanelSize(JSON.parse(stored));
  } catch (error) {
    console.error("Failed to get overlay panel size:", error);
    return { ...DEFAULT_OVERLAY_PANEL_SIZE };
  }
};

export const setOverlayPanelSize = (
  size: Partial<OverlayPanelSize>
): OverlayPanelSize => {
  const nextSize = normalizeOverlayPanelSize(size);

  try {
    localStorage.setItem(
      STORAGE_KEYS.OVERLAY_PANEL_SIZE,
      JSON.stringify(nextSize)
    );
    window.dispatchEvent(new Event("overlay-panel-size-changed"));
  } catch (error) {
    console.error("Failed to save overlay panel size:", error);
  }

  return nextSize;
};

// Helper function to check if any popover is open in the DOM
const isAnyPopoverOpen = (): boolean => {
  const popoverContents = document.querySelectorAll(
    "[data-radix-popper-content-wrapper]"
  );
  return popoverContents.length > 0;
};

export const useWindowResize = () => {
  const setWindowSize = useCallback(async (size: OverlayPanelSize) => {
    try {
      const window = getCurrentWebviewWindow();

      await invoke("set_window_size", {
        window,
        width: size.width,
        height: size.height,
      });
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, []);

  const resizeWindow = useCallback(async (expanded: boolean) => {
    try {
      if (!expanded && isAnyPopoverOpen()) {
        return;
      }

      await setWindowSize(
        expanded ? getOverlayPanelSize() : COLLAPSED_WINDOW_SIZE
      );
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, [setWindowSize]);

  const updateOverlayWindowSize = useCallback(
    async (size: Partial<OverlayPanelSize>) => {
      const nextSize = setOverlayPanelSize(size);
      await setWindowSize(nextSize);
      return nextSize;
    },
    [setWindowSize]
  );

  // Setup drag handling and popover monitoring
  useEffect(() => {
    let isDragging = false;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isDragRegion = target.closest('[data-tauri-drag-region="true"]');

      if (isDragRegion) {
        isDragging = true;
      }
    };

    const handleMouseUp = async () => {
      if (isDragging) {
        isDragging = false;

        setTimeout(() => {
          if (!isAnyPopoverOpen()) {
            resizeWindow(false);
          }
        }, 100);
      }
    };

    const observer = new MutationObserver(() => {
      if (!isAnyPopoverOpen()) {
        resizeWindow(false);
      }
    });

    // Observe the body for changes to detect popover open/close
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
      observer.disconnect();
    };
  }, [resizeWindow]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const setupResizeListener = async () => {
      try {
        const window = getCurrentWindow();

        unlisten = await window.onResized(async ({ payload }) => {
          if (saveTimer) {
            clearTimeout(saveTimer);
          }

          saveTimer = setTimeout(async () => {
            try {
              const scaleFactor = await window.scaleFactor();
              const nextSize = {
                width: payload.width / scaleFactor,
                height: payload.height / scaleFactor,
              };

              if (isExpandedPanelSize(nextSize)) {
                setOverlayPanelSize(nextSize);
              }
            } catch (error) {
              console.error("Failed to persist overlay panel size:", error);
            }
          }, 250);
        });
      } catch (error) {
        console.error("Failed to setup resize listener:", error);
      }
    };

    setupResizeListener();

    return () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return { resizeWindow, updateOverlayWindowSize };
};

interface UseWindowFocusOptions {
  onFocusLost?: () => void;
  onFocusGained?: () => void;
}

export const useWindowFocus = ({
  onFocusLost,
  onFocusGained,
}: UseWindowFocusOptions = {}) => {
  const handleFocusChange = useCallback(
    async (focused: boolean) => {
      if (focused && onFocusGained) {
        onFocusGained();
      } else if (!focused && onFocusLost) {
        onFocusLost();
      }
    },
    [onFocusLost, onFocusGained]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupFocusListener = async () => {
      try {
        const window = getCurrentWebviewWindow();

        // Listen to focus change events
        unlisten = await window.onFocusChanged(({ payload: focused }) => {
          handleFocusChange(focused);
        });
      } catch (error) {
        console.error("Failed to setup focus listener:", error);
      }
    };

    setupFocusListener();

    // Cleanup
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleFocusChange]);
};
