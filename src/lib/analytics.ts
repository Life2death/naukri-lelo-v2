import { PostHog } from "tauri-plugin-posthog-api";

/**
 * Event names for tracking
 */
export const ANALYTICS_EVENTS = {
  // App Lifecycle
  APP_STARTED: "app_started",
  // License Events
  GET_LICENSE: "get_license",
} as const;

/**
 * Capture an analytics event.
 * This is a no-op in open-source builds — the PostHog plugin is only
 * registered when compiled with a POSTHOG_API_KEY (official releases only).
 */
export const captureEvent = async (
  eventName: string,
  properties?: Record<string, any>
) => {
  try {
    await PostHog.capture(eventName, properties || {});
  } catch {
    // Silently ignore — PostHog plugin is not loaded in community builds
  }
};

/**
 * Track app initialization
 */
export const trackAppStart = async (appVersion: string, instanceId: string) => {
  await captureEvent(ANALYTICS_EVENTS.APP_STARTED, {
    app_version: appVersion,
    platform: navigator.platform,
    instance_id: instanceId,
  });
};
