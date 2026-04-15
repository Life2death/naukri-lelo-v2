import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/config";

const MIN_WIDTH = 400;
const MAX_WIDTH = 1400;
const WIDTH_STEP = 100;
const DEFAULT_WIDTH = 600;
const COLLAPSED_HEIGHT = 54;
const EXPANDED_HEIGHT = 600;

const getStoredWidth = (): number => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.OVERLAY_WIDTH);
    if (!stored) return DEFAULT_WIDTH;
    const n = parseInt(stored, 10);
    return isNaN(n) ? DEFAULT_WIDTH : Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  } catch {
    return DEFAULT_WIDTH;
  }
};

// Helper function to check if any popover is open in the DOM
const isAnyPopoverOpen = (): boolean => {
  const popoverContents = document.querySelectorAll(
    "[data-radix-popper-content-wrapper]"
  );
  return popoverContents.length > 0;
};

export const useWindowResize = () => {
  const [overlayWidth, setOverlayWidth] = useState<number>(getStoredWidth);

  const applySize = useCallback(async (width: number, height: number) => {
    try {
      const window = getCurrentWebviewWindow();
      await invoke("set_overlay_size", { window, width, height });
    } catch (error) {
      console.error("Failed to resize window:", error);
    }
  }, []);

  const resizeWindow = useCallback(
    async (expanded: boolean) => {
      if (!expanded && isAnyPopoverOpen()) return;
      const height = expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
      await applySize(overlayWidth, height);
    },
    [overlayWidth, applySize]
  );

  const changeWidth = useCallback(
    async (delta: number) => {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, overlayWidth + delta));
      if (newWidth === overlayWidth) return;
      setOverlayWidth(newWidth);
      try {
        localStorage.setItem(STORAGE_KEYS.OVERLAY_WIDTH, String(newWidth));
      } catch {}
      // Keep current height — collapsed (54) unless a popover is open
      const currentHeight = isAnyPopoverOpen() ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
      await applySize(newWidth, currentHeight);
    },
    [overlayWidth, applySize]
  );

  const increaseWidth = useCallback(() => changeWidth(WIDTH_STEP), [changeWidth]);
  const decreaseWidth = useCallback(() => changeWidth(-WIDTH_STEP), [changeWidth]);

  // Apply stored width on first mount so the window matches the saved preference
  useEffect(() => {
    applySize(overlayWidth, COLLAPSED_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return {
    resizeWindow,
    overlayWidth,
    increaseWidth,
    decreaseWidth,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
  };
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
