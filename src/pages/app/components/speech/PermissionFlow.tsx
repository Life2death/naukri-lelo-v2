import { useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import {
  CheckCircle2Icon,
  LoaderIcon,
  ShieldAlertIcon,
  ChevronDownIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

interface PermissionFlowProps {
  onPermissionGranted: () => void;
  onPermissionDenied: () => void;
}

type PermissionState = "checking" | "granted" | "denied" | "requesting";

export const PermissionFlow = ({
  onPermissionGranted,
  onPermissionDenied,
}: PermissionFlowProps) => {
  const [permissionState, setPermissionState] =
    useState<PermissionState>("checking");
  const [checkAttempts, setCheckAttempts] = useState(0);
  const [showManual, setShowManual] = useState(false);

  // Every timer/interval this component starts is tracked here and torn down
  // on unmount. Without this, closing the panel mid-flow left a 1Hz poll
  // running for up to 20s against an unmounted component — and if permission
  // happened to be granted in that window it called onPermissionGranted(),
  // starting audio capture from a panel the user had already closed. Reopening
  // the setup screen started a second concurrent poll on top.
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const isMountedRef = useRef(true);

  const trackedTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (isMountedRef.current) fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      intervalsRef.current.forEach(clearInterval);
      intervalsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      setPermissionState("checking");
      const hasAccess = await invoke<boolean>("check_system_audio_access");

      if (!isMountedRef.current) return;

      if (hasAccess) {
        setPermissionState("granted");
        trackedTimeout(() => onPermissionGranted(), 500);
      } else {
        setPermissionState("denied");
        onPermissionDenied();
      }
    } catch (error) {
      console.error("Permission check failed:", error);
      setPermissionState("denied");
      onPermissionDenied();
    }
  };

  const requestPermission = async () => {
    try {
      setPermissionState("requesting");
      await invoke("request_system_audio_access");

      let attempts = 0;
      const maxAttempts = 20;

      const stopPolling = () => {
        clearInterval(pollInterval);
        intervalsRef.current.delete(pollInterval);
      };

      const pollInterval = setInterval(async () => {
        if (!isMountedRef.current) {
          stopPolling();
          return;
        }

        attempts++;
        setCheckAttempts(attempts);

        try {
          const hasAccess = await invoke<boolean>("check_system_audio_access");
          if (!isMountedRef.current) {
            stopPolling();
            return;
          }

          if (hasAccess) {
            stopPolling();
            setPermissionState("granted");
            trackedTimeout(() => onPermissionGranted(), 500);
          } else if (attempts >= maxAttempts) {
            stopPolling();
            setPermissionState("denied");
            onPermissionDenied();
          }
        } catch (error) {
          console.error("Permission poll failed:", error);
        }
      }, 1000);
      intervalsRef.current.add(pollInterval);
    } catch (error) {
      console.error("Permission request failed:", error);
      setPermissionState("denied");
      onPermissionDenied();
    }
  };

  const stateConfig = {
    checking: {
      icon: <LoaderIcon className="w-5 h-5 animate-spin" />,
      title: "Checking Permissions",
      description: "Verifying system audio access...",
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      textColor: "text-blue-800",
      titleColor: "text-blue-900",
    },
    granted: {
      icon: <CheckCircle2Icon className="w-5 h-5" />,
      title: "Permission Granted",
      description: "Starting capture...",
      bgColor: "bg-green-50",
      borderColor: "border-green-200",
      textColor: "text-green-800",
      titleColor: "text-green-900",
    },
    requesting: {
      icon: <LoaderIcon className="w-5 h-5 animate-spin" />,
      title: "Waiting for Permission",
      description: `Enable Naukri Lelo in System Settings (${checkAttempts}/20)`,
      bgColor: "bg-orange-50",
      borderColor: "border-orange-200",
      textColor: "text-orange-800",
      titleColor: "text-orange-900",
    },
    denied: {
      icon: <ShieldAlertIcon className="w-5 h-5" />,
      title: "Permission Required",
      description: "Grant access to capture system audio",
      bgColor: "bg-muted/50",
      borderColor: "border-border",
      textColor: "text-muted-foreground",
      titleColor: "text-foreground",
    },
  };

  const config = stateConfig[permissionState];

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        config.bgColor,
        config.borderColor
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("flex-shrink-0", config.textColor)}>
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={cn("font-semibold text-sm mb-0.5", config.titleColor)}>
            {config.title}
          </h3>
          <p className={cn("text-xs", config.textColor)}>{config.description}</p>

          {permissionState === "denied" && (
            <div className="mt-3 space-y-2">
              <Button onClick={requestPermission} size="sm" className="w-full">
                Grant Permission
              </Button>
              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Manual setup
                <ChevronDownIcon
                  className={cn(
                    "w-3 h-3 transition-transform",
                    showManual && "rotate-180"
                  )}
                />
              </button>
              {showManual && (
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside pt-2 border-t border-border/50">
                  <li>Open System Settings</li>
                  <li>Go to Privacy & Security</li>
                  <li>Select Screen & System Audio Recording</li>
                  <li>Enable Naukri Lelo</li>
                </ol>
              )}
            </div>
          )}

          {permissionState === "requesting" && (
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkPermission}
                className="text-xs"
              >
                Check Now
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
